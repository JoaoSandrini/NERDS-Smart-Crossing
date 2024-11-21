/*
 * workspace-browser
 * https://github.com/aarranz/workspace-browser-widget
 *
 * Copyright (c) 2016-2017 CoNWeT Lab, Universidad Politécnica de Madrid
 * Copyright (c) 2017 Future Internet Consulting and Development Solutions S.L.
 * Licensed under the Apache-2.0 license.
 */

/* globals StyledElements, i18next */
/* exported WorkspaceBrowser */

(function (mp, se) {

    "use strict";

    var builder = new se.GUIBuilder();
    var empty_search_template = builder.DEFAULT_OPENING + '<div class="alert alert-warning"><p><t:empty_search_msg1/><b><t:keywords/>.</b></p><p><t:empty_search_msg2/></p><ul><li><t:empty_search_msg3/></li><li><t:empty_search_msg4/></li><li><t:empty_search_msg5/></li></ul></div>' + builder.DEFAULT_CLOSING;
    var error_template = builder.DEFAULT_OPENING + '<div class="alert alert-error"><t:message/></div>' + builder.DEFAULT_CLOSING;
    var corrected_query_template = builder.DEFAULT_OPENING + '<div class="alert alert-info"><p><t:corrected_query_msg/><b><t:corrected_query/></b></p></div>' + builder.DEFAULT_CLOSING;
    var workspace_template = builder.DEFAULT_OPENING +
        '<div class="workspace"><t:visibility/><div class="workspace-details"><div><strong><t:owner/>/<t:title/></strong></div><div><t:description/></div></div><div class="workspace-actions btn-group"><t:usebutton iconClass="fa fa-play"/><t:removebutton state="danger" iconClass="fa fa-trash"/></div></div>' +
        builder.DEFAULT_CLOSING;

    var request = null;
    var timeout = null;
    var anonymous = MashupPlatform.context.get('isanonymous');
    var current_user = mp.context.get('username');
    var current_workspace = mp.mashup.context.get('owner') + '/' + mp.mashup.context.get('name');

    // i18n
    i18next.init({
        fallbackLng: 'en',
        resources: {
            en: {
                translation: {
                    search_keywords: 'Search keywords',
                    all_dashboards: 'All Dashboards',
                    my_dashboards: 'My Dashboards',
                    others_dashboards: 'Others Dashboards',
                    private_dashboard: 'Private Dashboards',
                    shared_dashboards: 'Shared Dashboards',
                    public_dashboards: 'Public Dashboards',
                    empty_search_msg1: 'We couldn\'t find anything for your search - ',
                    empty_search_msg2: 'Suggestions:',
                    empty_search_msg3: 'Make sure all words are spelled correctly.',
                    empty_search_msg4: 'Try different keywords.',
                    empty_search_msg5: 'Try more general keywords.',
                    corrected_query_msg: 'Showing results for '
                }
            },
            es: {
                translation: {
                    search_keywords: 'Buscar',
                    all_dashboards: 'Todos los paneles',
                    my_dashboards: 'Mis paneles',
                    others_dashboards: 'Paneles de otros',
                    private_dashboards: 'Paneles privados',
                    shared_dashboards: 'Paneles compartidos',
                    public_dashboards: 'Paneles públicos',
                    empty_search_msg1: 'No hemos podido encontrar nada para su búsqueda - ',
                    empty_search_msg2: 'Sugerencias:',
                    empty_search_msg3: 'Asegúrese de que todas las palabras estén escritas correctamente.',
                    empty_search_msg4: 'Prueba a usar otros términos.',
                    empty_search_msg5: 'Prueba a usar términos más generales.',
                    corrected_query_msg: 'Mostrando resultados para '
                }
            },
            ja: {
                translation: {
                    search_keywords: '検索キーワード',
                    all_dashboards: '全てのダッシュボード',
                    my_dashboards: 'マイ・ダッシュボード',
                    others_dashboards: 'その他のダッシュボード',
                    private_dashboard: 'プライベート・ダッシュボード',
                    shared_dashboards: '共有ダッシュボード',
                    public_dashboards: 'パブリック・ダッシュボード',
                    empty_search_msg1: '検索で何も見つかりませんでした - ',
                    empty_search_msg2: '対処:',
                    empty_search_msg3: 'すべての単語のスペルが正しいことを確認してください',
                    empty_search_msg4: '異なるキーワードを試してみてください',
                    empty_search_msg5: 'より一般的なキーワードを試してください',
                    corrected_query_msg: '検索結果 '
                }
            }
        }
    });
    i18next.changeLanguage(mp.context.get('language'));

    var source = new se.PaginatedSource({
        pageSize: 30,
        requestFunc: function (page, options, resolve, reject) {
            var url = "/api/search";
            var query = text_input.value;

            if (request != null) {
                request.abort();
            }

            if (!anonymous) {
                if (privateButton.active) {
                    query += " shared:false";
                } else if (sharedButton.active) {
                    query += " shared:true public:false";
                } else if (publicButton.active) {
                    query += " public:true";
                }

                if (ownedButton.active) {
                    query += " owner:" + mp.context.get('username');
                } else if (othersButton.active) {
                    query += " NOT owner:" + mp.context.get('username');
                }
            }

            request = mp.http.makeRequest(url, {
                method: 'GET',
                supportsAccessControl: true,
                parameters: {
                    namespace: "workspace",
                    q: query,
                    pagenum: page,
                    maxresults: options.pageSize
                },
                onComplete: function (response) {
                    var data, raw_data;

                    if (response.status === 200) {
                        try {
                            raw_data = JSON.parse(response.responseText);
                            data = {
                                resources: raw_data.results,
                                current_page: parseInt(raw_data.pagenum, 10),
                                total_count: parseInt(raw_data.total, 10)
                            };
                            if ('corrected_q' in raw_data) {
                                data.corrected_query = raw_data.corrected_q;
                            }
                        } catch (e) {
                            reject("Invalid response from server");
                        }
                        resolve(data.resources, data);
                    } else if (response.status === 0) {
                        reject("Error connecting with the server");
                    } else {
                        reject("Invalid response from server");
                    }
                }
            });
        },
        processFunc: function (workspaces, search_info) {
            var message;

            layout.center.clear();

            if (search_info.total_count === 0) {
                message = builder.parse(empty_search_template, {
                    keywords: text_input.value,
                    empty_search_msg1: i18next.t('empty_search_msg1'),
                    empty_search_msg2: i18next.t('empty_search_msg2'),
                    empty_search_msg3: i18next.t('empty_search_msg3'),
                    empty_search_msg4: i18next.t('empty_search_msg4'),
                    empty_search_msg5: i18next.t('empty_search_msg5')
                });
                layout.center.appendChild(message);
                return;
            }

            if ('corrected_query' in search_info) {
                message = builder.parse(corrected_query_template, {
                    corrected_query: search_info.corrected_query,
                    corrected_query_msg: i18next.t('corrected_query_msg')
                });
                layout.center.appendChild(message);
            }

            workspaces.forEach(function (workspace, search_info) {
                var workspace_entry = builder.parse(workspace_template, {
                    name: workspace.name,
                    title: workspace.title,
                    owner: workspace.owner,
                    description: workspace.description,
                    visibility: function (options) {
                        var element = document.createElement('i');
                        element.className = "fa fa-fw fa-2x";
                        if (workspace.public) {
                            element.classList.add('fa-globe');
                        } else if (workspace.shared) {
                            element.classList.add('fa-share-alt');
                        } else {
                            element.classList.add('fa-lock');
                        }
                        return element;
                    },
                    usebutton: function (options) {
                        var button = new se.Button(options);
                        button.addEventListener("click", function () {
                            mp.mashup.openWorkspace(workspace);
                        });
                        button.enabled = (workspace.owner + '/' + workspace.name) !== current_workspace;
                        return button;
                    },
                    removebutton: function (options) {
                        if (!anonymous) {
                            var button = new se.Button(options);
                            button.addEventListener("click", function () {
                                mp.mashup.removeWorkspace(workspace, {
                                    onSuccess: function () {
                                        source.refresh();
                                    }
                                });
                            });
                            button.enabled = workspace.owner === current_user;
                            return button;
                        }
                    }
                });
                layout.center.appendChild(workspace_entry);
            });
        }
    });
    source.addEventListener('requestStart', function () {
        layout.center.disable();
    });

    source.addEventListener('requestEnd', function (source, error) {
        layout.center.enable();

        if (error) {
            layout.center.clear();

            var message = builder.parse(error_template, {message: error});
            layout.center.appendChild(message);
        }
    });

    var keywordTimeoutHandler = function keywordTimeoutHandler() {
        timeout = null;
        source.refresh();
    };

    var onSearchInputChange = function onSearchInputChange(modifiers) {
        if (timeout !== null) {
            clearTimeout(timeout);
            timeout = null;
        }

        timeout = setTimeout(keywordTimeoutHandler, 700);
    };

    var onSearchInputKeyPress = function onSearchInputKeyPress(input, modifiers, key) {
        if (modifiers.controlKey === false && modifiers.altKey === false && key === "Enter") { // enter

            // Cancel current timeout
            if (timeout !== null) {
                clearTimeout(timeout);
                timeout = null;
            }

            // Inmediate search
            source.refresh();
        }
    };

    var layout = new se.VerticalLayout();
    layout.appendTo(document.body);

    var heading_layout = new se.HorizontalLayout();
    layout.north.appendChild(heading_layout);

    // Input field
    var input_div = new se.Container({class: "se-input-group se-input-group-block"});
    var text_input = new StyledElements.StyledTextField({placeholder: i18next.t('search_keywords')});
    input_div.appendChild(text_input);
    text_input.addEventListener('keydown', onSearchInputKeyPress);
    text_input.addEventListener('change', onSearchInputChange);
    heading_layout.center.appendChild(input_div);

    if (!anonymous) {
        // Owner filter buttons
        var filter_buttons = new se.Container({class: 'btn-group'});
        heading_layout.east.appendChild(filter_buttons);

        var allButton = new se.ToggleButton({iconClass: 'fa fa-circle', title: i18next.t('all_dashboards')});
        allButton.addEventListener('click', function () {
            allButton.active = true;
            ownedButton.active = false;
            othersButton.active = false;
            source.refresh();
        });
        allButton.active = true;
        filter_buttons.appendChild(allButton);
        var ownedButton = new se.ToggleButton({iconClass: 'fa fa-user', title: i18next.t('my_dashboards')});
        ownedButton.addEventListener('click', function () {
            allButton.active = false;
            ownedButton.active = true;
            othersButton.active = false;
            source.refresh();
        });
        filter_buttons.appendChild(ownedButton);
        var othersButton = new se.ToggleButton({iconClass: 'fa fa-users', title: i18next.t('others_dashboards')});
        othersButton.addEventListener('click', function () {
            allButton.active = false;
            ownedButton.active = false;
            othersButton.active = true;
            source.refresh();
        });
        filter_buttons.appendChild(othersButton);

        // Visibility filter buttons
        var visibility_buttons = new se.Container({class: 'btn-group'});
        heading_layout.east.appendChild(visibility_buttons);

        var anyButton = new se.ToggleButton({iconClass: 'fa fa-circle', title: i18next.t('all_dashboards')});
        anyButton.addEventListener('click', function () {
            anyButton.active = true;
            privateButton.active = false;
            sharedButton.active = false;
            publicButton.active = false;
            source.refresh();
        });
        anyButton.active = true;
        visibility_buttons.appendChild(anyButton);

        var privateButton = new se.ToggleButton({iconClass: 'fa fa-lock', title: i18next.t('private_dashboard')});
        privateButton.addEventListener('click', function () {
            anyButton.active = false;
            privateButton.active = true;
            sharedButton.active = false;
            publicButton.active = false;
            source.refresh();
        });
        visibility_buttons.appendChild(privateButton);

        var sharedButton = new se.ToggleButton({iconClass: 'fa fa-share-alt', title: i18next.t('shared_dashboards')});
        sharedButton.addEventListener('click', function () {
            anyButton.active = false;
            privateButton.active = false;
            sharedButton.active = true;
            publicButton.active = false;
            source.refresh();
        });
        visibility_buttons.appendChild(sharedButton);

        var publicButton = new se.ToggleButton({iconClass: 'fa fa-globe', title: i18next.t('public_dashboards')});
        publicButton.addEventListener('click', function () {
            anyButton.active = false;
            privateButton.active = false;
            sharedButton.active = false;
            publicButton.active = true;
            source.refresh();
        });
        visibility_buttons.appendChild(publicButton);
    }

    layout.center.addClassName('loading');

    var pagination = new se.PaginationInterface(source);
    layout.south.appendChild(pagination);

    source.refresh();

})(MashupPlatform, StyledElements);
