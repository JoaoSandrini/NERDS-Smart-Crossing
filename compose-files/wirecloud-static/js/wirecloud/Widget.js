/*
 *     Copyright (c) 2013-2017 CoNWeT Lab., Universidad Politécnica de Madrid
 *     Copyright (c) 2019-2023 Future Internet Consulting and Development Solutions S.L.
 *
 *     This file is part of Wirecloud Platform.
 *
 *     Wirecloud Platform is free software: you can redistribute it and/or
 *     modify it under the terms of the GNU Affero General Public License as
 *     published by the Free Software Foundation, either version 3 of the
 *     License, or (at your option) any later version.
 *
 *     Wirecloud is distributed in the hope that it will be useful, but WITHOUT
 *     ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 *     FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public
 *     License for more details.
 *
 *     You should have received a copy of the GNU Affero General Public License
 *     along with Wirecloud Platform.  If not, see
 *     <http://www.gnu.org/licenses/>.
 *
 */

/* globals StyledElements, Wirecloud */


(function (ns, se, utils) {

    "use strict";

    const privates = new WeakMap();

    const STATUS = {
        CREATED: 0,
        LOADING: 1,
        RUNNING: 2,
        UNLOADING: 3
    };

    const build_endpoints = function build_endpoints() {
        this.inputs = {};
        this.meta.inputList.forEach(function (endpoint) {
            this.inputs[endpoint.name] = new Wirecloud.wiring.WidgetTargetEndpoint(this, endpoint);
        }, this);
        this.outputs = {};
        this.meta.outputList.forEach(function (endpoint) {
            this.outputs[endpoint.name] = new Wirecloud.wiring.WidgetSourceEndpoint(this, endpoint);
        }, this);
    };

    const build_prefs = function build_prefs(initial_values) {
        this.preferenceList = [];
        this.preferences = {};

        this.meta.preferenceList.forEach((preference) => {
            if (preference.name in initial_values) {
                // Use the settings from persistence
                const pref_data = initial_values[preference.name];
                this.preferences[preference.name] = new Wirecloud.UserPref(preference, pref_data.readonly, pref_data.hidden, pref_data.value);
            } else {
                // Use the default settings for this preference
                this.preferences[preference.name] = new Wirecloud.UserPref(preference, false, false, preference.default);
            }

            this.preferenceList.push(this.preferences[preference.name]);
        });
    };

    const build_props = function build_props(initial_values) {
        this.propertyList = [];
        this.properties = {};
        this.propertyCommiter = new Wirecloud.PropertyCommiter(this);
        this.meta.propertyList.forEach((property) => {
            if (property.name in initial_values) {
                // Use the settings from persistence
                const prop_data = initial_values[property.name];
                this.properties[property.name] = new Wirecloud.PersistentVariable(property, this.propertyCommiter, prop_data.readonly, prop_data.value);
            } else {
                // Use the default settings for this property
                this.properties[property.name] = new Wirecloud.PersistentVariable(property, this.propertyCommiter, false, property.default);
            }

            this.propertyList.push(this.properties[property.name]);
        });
    }

    const _remove = function _remove() {
        this.fullDisconnect();

        if (this.loaded) {
            on_unload.call(this);
        }

        this.dispatchEvent('remove');
    };

    const change_meta = function change_meta(meta) {
        let sync_values;

        const old_value = privates.get(this).meta;
        privates.get(this).meta = meta;

        if (!this.volatile && !meta.missing) {
            const process_response = (response) => {
                if (response.status !== 200) {
                    return Promise.reject(new Error("Unexpected response from server"));
                }
                try {
                    return JSON.parse(response.responseText);
                } catch (e) {
                    return Promise.reject("Unexpected response from server");
                }
            };

            sync_values = Promise.all([
                // Request preferences
                Wirecloud.io.makeRequest(Wirecloud.URLs.IWIDGET_PREFERENCES.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                }), {
                    method: 'GET',
                    requestHeaders: {'Accept': 'application/json'},
                }).then(process_response),
                // Request properties
                Wirecloud.io.makeRequest(Wirecloud.URLs.IWIDGET_PROPERTIES.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                }), {
                    method: 'GET',
                    requestHeaders: {'Accept': 'application/json'},
                }).then(process_response)
            ]);
        } else {
            sync_values = Promise.resolve([{}, {}]);
        }

        return sync_values.then((values) => {
            build_endpoints.call(this);
            build_prefs.call(this, values[0]);
            build_props.call(this, values[1]);

            if (this.loaded) {
                on_unload.call(this);
                _createWrapper.call(this);
                this.load();
            }

            this.dispatchEvent('change', ['meta'], {meta: old_value});;
        });
    };

    const _createWrapper = function _createWrapper() {
        const wrapperElement = document.createElement((this.meta.macversion > 1) ? 'wirecloud-widget' : 'iframe');
        if (this.wrapperElement) {
            this.wrapperElement.parentNode.replaceChild(wrapperElement, this.wrapperElement);
        }
        this.wrapperElement = wrapperElement;
        this.wrapperElement.className = "wc-widget-content";
        this.wrapperElement.addEventListener('load', on_load.bind(this), true);
        if (this.meta.missing || this.meta.macversion === 1) {
            this.wrapperElement.setAttribute('frameBorder', "0");

            this.meta.requirements.some(function (requirement) {
                if (requirement.type === 'feature' && requirement.name === 'FullscreenWidget') {
                    this.wrapperElement.setAttribute('allowfullscreen', 'true');
                    return true;
                }
            }, this);
        }
    };

    const _rename = function _rename(title) {
        this.contextManager.modify({
            title: title
        });
        this.dispatchEvent('change', ['title']);
    };

    const _setPermissions = function _setPermissions(widget, permissions) {
        utils.update(privates.get(widget).permissions.viewer, permissions);
        widget.dispatchEvent('change', ['permissions']);
        return Promise.resolve(widget);
    };

    const _setTitleVisibility = function _setTitleVisibility(widget, visibility) {
        privates.get(widget).titlevisible = visibility;
        widget.dispatchEvent('change', ['titlevisible']);
        return Promise.resolve(widget);
    };

    const _loadScripts = function _loadScripts() {
        // We need to wait for the scripts to be loaded before loading the widget
        const promises = [];
        this.meta.js_files.forEach((js_file) => {
            if (js_file in Wirecloud.loadedScripts) {
                Wirecloud.loadedScripts[js_file].users.push(this);
                this.loaded_scripts.push(Wirecloud.loadedScripts[js_file].elem);
                if (!Wirecloud.loadedScripts[js_file].loaded) {
                    promises.push(new Promise((resolve, reject) => {
                        Wirecloud.loadedScripts[js_file].elem.addEventListener('load', resolve);
                        Wirecloud.loadedScripts[js_file].elem.addEventListener('error', resolve);
                    }));
                }
                return; // Already added to the DOM by another widget
            }

            const script = document.createElement('script');
            script.setAttribute('type', 'text/javascript');
            script.setAttribute('src', js_file);
            script.dataset.id = this.meta.uri;
            script.async = false;
            document.body.appendChild(script);
            this.loaded_scripts.push(script);
            Wirecloud.loadedScripts[js_file] = {loaded: false, elem: script, users: [this]};

            const promise = new Promise((resolve, reject) => {
                const on_resolve = () => {
                    Wirecloud.loadedScripts[js_file].loaded = true;
                    resolve();
                }

                // Resolve the promise when the script is loaded or an error occurs
                script.addEventListener('load', on_resolve.bind(this));
                script.addEventListener('error', on_resolve.bind(this));
            });

            promises.push(promise);
        });

        return Promise.all(promises);
    };

    const _unloadScripts = function _unloadScripts() {
        this.loaded_scripts.forEach((script) => {
            if (script.src in Wirecloud.loadedScripts && Wirecloud.loadedScripts[script.src].users.length === 1) {
                delete Wirecloud.loadedScripts[script.src];
                document.body.removeChild(script);
            } else if (script.src in Wirecloud.loadedScripts) {
                const index = Wirecloud.loadedScripts[script.src].users.indexOf(this);
                if (index !== -1) {
                    Wirecloud.loadedScripts[script.src].users.splice(index, 1);
                }
            }
        });
        this.loaded_scripts = [];
    };

    const clean_title = function clean_title(title) {
        if (typeof title !== 'string' || !title.trim().length) {
            throw new TypeError("invalid title parameter");
        }

        return title.trim();
    };

    const is_valid_meta = function is_valid_meta(meta) {
        return meta instanceof Wirecloud.WidgetMeta && meta.group_id === this.meta.group_id;
    };

    const remove_context_callbacks = function remove_context_callbacks() {
        let i;

        for (i = 0; i < this.callbacks.iwidget.length; i += 1) {
            this.contextManager.removeCallback(this.callbacks.iwidget[i]);
        }

        for (i = 0; i < this.callbacks.mashup.length; i += 1) {
            this.tab.workspace.contextManager.removeCallback(this.callbacks.mashup[i]);
        }

        for (i = 0; i < this.callbacks.platform.length; i += 1) {
            Wirecloud.contextManager.removeCallback(this.callbacks.platform[i]);
        }

        this.callbacks = {
            'iwidget': [],
            'mashup': [],
            'platform': []
        };
    };

    const send_pending_event = function send_pending_event(pendingEvent) {
        this.inputs[pendingEvent.endpoint].propagate(pendingEvent.value);
    };

    const censor_secure_preferences = function censor_secure_preferences(newValues) {
        // Censor secure preferences
        for (const varName in newValues) {
            if (this.preferences[varName].meta.secure) {
                newValues[varName] = "********";
            }
        }
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    const on_preremovetab = function on_preremovetab(tab) {
        _remove.call(this);
        tab.removeEventListener('preremove', privates.get(this).on_preremovetab);
    };

    const on_load = function on_load() {

        if ((this.meta.macversion > 1 && this.wrapperElement.loadedURL !== this.codeurl) ||
            ((this.meta.missing || this.meta.macversion === 1) && this.wrapperElement.contentWindow.location.href !== this.codeurl)) {
            return;
        }

        if (this.meta.macversion > 1) {
            // If this is a v2 or later widget, we need to instantiate it's entrypoint class
            _unloadScripts.call(this);
            _loadScripts.call(this).then(() => {
                let entrypoint = Wirecloud.APIComponents[this.meta.uri];
                if (!entrypoint) {
                    entrypoint = window[this.meta.entrypoint];
                }

                if (entrypoint === undefined) {
                    this.logManager.log("Widget entrypoint class not found!", {console: false});
                } else {
                    this.widgetClass = Wirecloud.createAPIComponent("widget", this.meta.requirements, entrypoint,
                        this.wrapperElement, this.id,
                        ('workspaceview' in this.tab.workspace.view) ? this.tab.workspace.view.workspaceview : undefined,
                        this.meta.base_url);
                }

                privates.get(this).status = STATUS.RUNNING;

                this.dispatchEvent('load');

                this.pending_events.forEach(send_pending_event, this);
                this.pending_events = [];
            });
        } else {
            privates.get(this).status = STATUS.RUNNING;

            this.dispatchEvent('load');

            this.pending_events.forEach(send_pending_event, this);
            this.pending_events = [];
        }

        if (this.meta.macversion > 1) {
            this.wrapperElement.addEventListener('unload', on_unload.bind(this), true);
        } else {
            this.wrapperElement.contentDocument.defaultView.addEventListener('unload', on_unload.bind(this), true);
        }

        if (this.missing) {
            this.logManager.log(utils.gettext("Failed to load widget."), {
                level: Wirecloud.constants.LOGGING.ERROR_MSG,
                details: new se.Fragment(utils.gettext("<p>This widget is currently not available. You or an administrator probably uninstalled it.</p><h5>Suggestions:</h5><ul><li>Remove this widget from the dashboard</li><li>Reinstall the appropiated version of the widget</li><li>Or install another version of the widget and then use the <em>Upgrade/Downgrade</em> option</li></ul>"))
            });
        } else {
            this.logManager.log(utils.gettext("Widget loaded successfully."), {
                level: Wirecloud.constants.LOGGING.INFO_MSG
            });
        }
    };

    const on_unload = function on_unload() {
        const priv = privates.get(this);

        if (priv.status !== STATUS.RUNNING && priv.status !== STATUS.UNLOADING) {
            return;
        }

        if (this.loaded_scripts.length !== 0) {
            _unloadScripts.call(this);
        }

        if (this.widgetClass !== undefined) {
            // If this is a v2 or later widget, we need to destroy it's entrypoint class
            if ('destroy' in this.widgetClass) {
                this.widgetClass.destroy();
            }
            delete this.widgetClass;
        }

        // Currently, the only scenario where current status can be "unloading"
        // is when reloading the widget
        priv.status = priv.status === STATUS.RUNNING ? STATUS.CREATED : STATUS.LOADING;
        this.prefCallback = null;

        remove_context_callbacks.call(this);
        this.propertyCommiter.commit();

        for (const name in this.inputs) {
            this.inputs[name].callback = null;
        }

        this.logManager.log(utils.gettext("Widget unloaded successfully."), {
            level: Wirecloud.constants.LOGGING.INFO_MSG
        });
        this.logManager.newCycle();

        this.dispatchEvent('unload');
    };

    ns.Widget = class Widget extends se.ObjectWithEvents {

        /**
         * @name Wirecloud.Widget
         *
         * @extends {StyledElements.ObjectWithEvents}
         * @constructor
         *
         * @param {Wirecloud.WorkspaceTab} tab
         * @param {Wirecloud.WidgetMeta} meta
         * @param {Object} data
         */
        constructor(tab, meta, data) {
            super([
                'change',
                'load',
                'remove',
                'unload'
            ]);

            if (data == null) {
                throw new TypeError("invalid data parameter");
            }

            data = utils.merge({
                title: meta.title,
                preferences: {},
                properties: {},
                titlevisible: true
            }, data);

            this.pending_events = [];
            this.loaded_scripts = [];
            this.prefCallback = null;

            if (data.permissions == null) {
                data.permissions = {};
            }

            const permissions = {
                'editor': Wirecloud.Utils.merge({
                    close: true,
                    configure: true,
                    move: true,
                    rename: true,
                    resize: true,
                    minimize: true,
                    upgrade: true
                }, data.permissions.editor),
                'viewer': Wirecloud.Utils.merge({
                    close: false,
                    configure: false,
                    move: false,
                    rename: false,
                    resize: false,
                    minimize: false,
                    upgrade: false
                }, data.permissions.viewer)
            };

            // TODO
            if (data.readonly) {
                permissions.editor.close = false;
                permissions.editor.upgrade = false;
                permissions.viewer.close = false;
                permissions.viewer.upgrade = false;
                permissions.viewer.upgrade = false;
            }

            privates.set(this, {
                permissions: permissions,
                position: {
                    anchor: data.anchor,
                    relx: data.relx,
                    rely: data.rely,
                    x: data.left,
                    y: data.top,
                    z: data.zIndex
                },
                meta: meta,
                shape: {
                    relheight: data.relheight,
                    relwidth: data.relwidth,
                    width: data.width,
                    height: data.height
                },
                status: STATUS.CREATED,
                tab: tab,
                titlevisible: !!data.titlevisible,
                on_preremovetab: on_preremovetab.bind(this)
            });

            Object.defineProperties(this, {
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {String}
                 */
                codeurl: {
                    get: function () {
                        let url = this.meta.codeurl + "#id=" + encodeURIComponent(this.id);
                        if ('workspaceview' in this.tab.workspace.view) {
                            url += "&workspaceview=" + encodeURIComponent(this.tab.workspace.view.workspaceview);
                        }
                        return url;
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {String}
                 */
                id: {
                    value: data.id
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                loaded: {
                    get: function () {
                        return privates.get(this).status === STATUS.RUNNING;
                    },
                    set: function (value) { // Just for testing purposes
                        privates.get(this).status = STATUS.RUNNING;
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                logManager: {
                    value: new Wirecloud.LogManager(Wirecloud.GlobalLogManager)
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Wirecloud.WidgetMeta}
                 */
                meta: {
                    get: function () {
                        return privates.get(this).meta;
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                missing: {
                    get: function () {
                        return this.meta.missing;
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Wirecloud.WorkspaceTab}
                 */
                tab: {
                    get: function () {
                        return privates.get(this).tab;
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {String}
                 */
                title: {
                    get: function () {
                        return this.contextManager.get('title');
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                volatile: {
                    value: !!data.volatile
                }
            });
            this.fulldragboard = data.fulldragboard;

            _createWrapper.call(this);

            build_endpoints.call(this);
            build_prefs.call(this, data.preferences);
            build_props.call(this, data.properties);

            Object.defineProperties(this, {
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Number}
                 */
                layout: {
                    writable: true,
                    value: data.layout
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                minimized: {
                    writable: true,
                    value: data.minimized
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Object}
                 */
                permissions: {
                    get: function () {
                        return utils.clone(privates.get(this).permissions);
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Object}
                 */
                position: {
                    get: function () {
                        return utils.clone(privates.get(this).position);
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Object}
                 */
                shape: {
                    get: function () {
                        return utils.clone(privates.get(this).shape);
                    }
                },
                /**
                 * @memberOf Wirecloud.Widget#
                 * @type {Boolean}
                 */
                titlevisible: {
                    get: () => {
                        return privates.get(this).titlevisible;
                    }
                }
            });

            this.callbacks = {
                'iwidget': [],
                'mashup': [],
                'platform': []
            };

            this.contextManager = new Wirecloud.ContextManager(this, {
                title: {
                    label: utils.gettext("Title"),
                    description: utils.gettext("Widget's title"),
                    value: data.title
                },
                xPosition: {
                    label: utils.gettext("X-Position"),
                    description: utils.gettext("Specifies the x-coordinate at which the widget is placed"),
                    value: data.left
                },
                yPosition: {
                    label: utils.gettext("Y-Position"),
                    description: utils.gettext("Specifies the y-coordinate at which the widget is placed"),
                    value: data.top
                },
                zPosition: {
                    label: utils.gettext("Z-Position"),
                    description: utils.gettext("Specifies the z-coordinate at which the widget is placed"),
                    value: data.zIndex
                },
                height: {
                    label: utils.gettext("Height"),
                    description: utils.gettext("Widget's height in layout cells"),
                    value: data.height
                },
                visible: {
                    label: utils.gettext("Visible"),
                    description: utils.gettext("Specifies if the widget is being displayed, altough the user may have to do scroll to be able to see it"),
                    value: false
                },
                width: {
                    label: utils.gettext("Width"),
                    description: utils.gettext("Widget's width in layout cells"),
                    value: data.width
                },
                heightInPixels: {
                    label: utils.gettext("Height in pixels (deprecated)"),
                    description: utils.gettext("Widget's height in pixels"),
                    value: 0
                },
                widthInPixels: {
                    label: utils.gettext("Width in pixels"),
                    description: utils.gettext("Widget's width in pixels"),
                    value: 0
                },
                volatile: {
                    label: utils.gettext("Volatile"),
                    description: utils.gettext("Volatile status of the widget"),
                    value: this.volatile
                }
            });

            this.tab.addEventListener('preremove', privates.get(this).on_preremovetab);

            this.logManager.log(utils.gettext("Widget created successfully."), Wirecloud.constants.LOGGING.DEBUG_MSG);
        }

        changeTab(tab) {
            const priv = privates.get(this);

            if (priv.tab === tab) {
                return Promise.resolve(this);
            } else {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                const content = {
                    tab: tab.id
                };

                return Wirecloud.io.makeRequest(url, {
                    method: 'POST',
                    requestHeaders: {'Accept': 'application/json'},
                    contentType: 'application/json',
                    postBody: JSON.stringify(content)
                }).then((response) => {
                    if (response.status === 204) {
                        priv.tab = tab;
                        this.dispatchEvent('change', ['tab']);
                        return Promise.resolve(this);
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            }
        }

        fullDisconnect() {
            let name;

            for (name in this.inputs) {
                this.inputs[name].fullDisconnect();
            }

            for (name in this.outputs) {
                this.outputs[name].fullDisconnect();
            }

            return this;
        }

        hasEndpoints() {
            return this.meta.hasEndpoints();
        }

        hasPreferences() {
            return this.meta.hasPreferences();
        }

        is(component) {
            return this.meta.type === component.meta.type && this.id === component.id;
        }

        /**
         * @param {String} name
         * @param {String} [role] (default: `"viewer"`)
         *
         * @returns {Boolean}
         */
        isAllowed(name, role) {

            if (role == null) {
                role = "viewer";
            }
            const permissions = privates.get(this).permissions[role];

            if (!(name in permissions)) {
                throw new TypeError("invalid name parameter");
            }

            if (!this.volatile) {
                switch (name) {
                case "close":
                    return permissions.close && this.tab.workspace.isAllowed('add_remove_iwidgets');
                case "move":
                case "resize":
                case "minimize":
                    return permissions[name] && this.tab.workspace.isAllowed('edit_layout');
                default:
                    return !this.tab.workspace.restricted && permissions[name];
                }
            } else {
                return permissions[name];
            }
        }

        /**
         * @returns {Wirecloud.Widget}
         */
        load() {

            if (privates.get(this).status !== STATUS.CREATED) {
                return this;
            }

            privates.get(this).status = STATUS.LOADING;
            if (this.meta.macversion > 1) {
                this.wrapperElement.load(this.codeurl);
            } else {
                this.wrapperElement.contentWindow.location.replace(this.codeurl);
                this.wrapperElement.setAttribute('type', this.meta.codecontenttype);
            }

            return this;
        }

        /**
         * @returns {Wirecloud.Widget}
         */
        reload() {
            const priv = privates.get(this);
            priv.status = STATUS.UNLOADING;

            if (this.meta.macversion > 1) {
                this.wrapperElement.load(this.wrapperElement.loadedURL);
            } else {
                this.wrapperElement.setAttribute('type', this.meta.codecontenttype);
                this.wrapperElement.contentWindow.location.reload();
            }

            return this;
        }

        registerContextAPICallback(scope, callback) {
            switch (scope) {
            case 'iwidget':
                this.contextManager.addCallback(callback);
                break;
            case 'mashup':
                this.tab.workspace.contextManager.addCallback(callback);
                break;
            case 'platform':
                Wirecloud.contextManager.addCallback(callback);
                break;
            default:
                throw new TypeError('invalid scope parameter');
            }

            this.callbacks[scope].push(callback);
        }

        /**
         * @param {Function} callback
         *
         * @returns {Wirecloud.Widget}
         */
        registerPrefCallback(callback) {
            this.prefCallback = callback;
            return this;
        }

        /**
         * @returns {Promise}
         */
        remove() {
            if (this.volatile) {
                _remove.call(this);
                return Promise.resolve(this);
            } else {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                return Wirecloud.io.makeRequest(url, {
                    method: 'DELETE',
                    requestHeaders: {'Accept': 'application/json'}
                }).then((response) => {
                    if (response.status === 204) {
                        _remove.call(this);
                        return Promise.resolve(this);
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            }
        }

        /**
         * @param {String} title
         *
         * @returns {Promise}
         */
        rename(title) {
            title = clean_title.call(this, title);

            if (this.volatile) {
                _rename.call(this, title);
                return Promise.resolve(this);
            } else {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                const payload = {
                    title: title
                };

                return Wirecloud.io.makeRequest(url, {
                    method: 'POST',
                    requestHeaders: {'Accept': 'application/json'},
                    contentType: 'application/json',
                    postBody: JSON.stringify(payload)
                }).then((response) => {
                    if (response.status === 204) {
                        _rename.call(this, title);
                        return Promise.resolve(this);
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            }
        }

        /**
         * Updates viewer permissions over the widget.
         *
         * @param {Object} permissions object with the permissions to modify
         *
         * @returns {Wirecloud.Task}
         */
        setPermissions(permissions) {
            if (this.volatile) {
                return _setPermissions(this, permissions);
            } else {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                const payload = {
                    permissions: {
                        viewer: permissions
                    }
                };

                return Wirecloud.io.makeRequest(url, {
                    method: 'POST',
                    requestHeaders: {'Accept': 'application/json'},
                    contentType: 'application/json',
                    postBody: JSON.stringify(payload)
                }).then((response) => {
                    if (response.status === 204) {
                        return _setPermissions(this, permissions);
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            }
        }

        setPosition(position) {
            utils.update(privates.get(this).position, position);
            return this;
        }

        setPreferences(newValues) {
            // We are going to modify the object, let's create a copy
            newValues = Object.assign({}, newValues);

            for (const prefName in newValues) {
                if (!(prefName in this.preferences)) {
                    delete newValues[prefName];
                    continue;
                }

                const oldValue = this.preferences[prefName].value;
                const newValue = newValues[prefName];

                if (newValue !== oldValue) {
                    if (this.preferences[prefName].meta.secure && newValue !== "") {
                        this.preferences[prefName].value = "********";
                    } else {
                        this.preferences[prefName].value = newValue;
                    }
                } else {
                    delete newValues[prefName];
                }
            }

            if (!this.volatile && Object.keys(newValues).length > 0) {
                return Wirecloud.io.makeRequest(Wirecloud.URLs.IWIDGET_PREFERENCES.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                }), {
                    method: 'POST',
                    contentType: 'application/json',
                    requestHeaders: {'Accept': 'application/json'},
                    postBody: JSON.stringify(newValues)
                }).then((response) => {
                    if (response.status !== 204) {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }

                    censor_secure_preferences.call(this, newValues);

                    try {
                        this.prefCallback(newValues);
                    } catch (error) {
                        const details = this.logManager.formatException(error);
                        this.logManager.log(utils.gettext('Exception catched while processing preference changes'), {details: details});
                    }

                    return newValues;
                });
            } else {
                censor_secure_preferences.call(this, newValues);
                return Promise.resolve(newValues);
            }
        }

        setShape(shape) {
            // TODO: is minimized
            utils.update(privates.get(this).shape, shape);
            return this;
        }

        /**
         * Set title visibility on persistence
         *
         * @returns {Promise}
         */
        setTitleVisibility(visibility, persistence) {
            visibility = !!visibility;

            if (this.volatile) {
                return _setTitleVisibility(this, visibility);
            } else if (persistence) {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                const payload = {
                    titlevisible: visibility
                };

                return Wirecloud.io.makeRequest(url, {
                    method: 'POST',
                    requestHeaders: {'Accept': 'application/json'},
                    contentType: 'application/json',
                    postBody: JSON.stringify(payload)
                }).then((response) => {
                    if (response.status === 204) {
                        return _setTitleVisibility(this, visibility);
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            } else {
                privates.get(this).titlevisible = visibility;
                this.dispatchEvent('change', ['titlevisible']);
                return Promise.resolve(this);
            }
        }

        /**
         * @returns {Wirecloud.Widget}
         */
        showLogs() {
            const dialog = new Wirecloud.ui.LogWindowMenu(this.logManager);
            dialog.htmlElement.classList.add("wc-component-logs-modal");
            dialog.show();
            return this;
        }

        /**
         * @returns {Wirecloud.Widget}
         */
        showSettings() {
            const dialog = new Wirecloud.Widget.PreferencesWindowMenu();
            dialog.show(this);
            return this;
        }

        /**
         * @param {Wirecloud.WidgetMeta} meta
         */
        upgrade(meta) {

            if (!is_valid_meta.call(this, meta)) {
                throw new TypeError("invalid meta parameter");
            }

            if (this.meta.uri === meta.uri) {
                // From/to missing
                return change_meta.call(this, meta);
            } else {
                const url = Wirecloud.URLs.IWIDGET_ENTRY.evaluate({
                    workspace_id: this.tab.workspace.id,
                    tab_id: this.tab.id,
                    iwidget_id: this.id
                });

                const payload = {
                    widget: meta.uri
                };

                return Wirecloud.io.makeRequest(url, {
                    method: 'POST',
                    requestHeaders: {'Accept': 'application/json'},
                    contentType: 'application/json',
                    postBody: JSON.stringify(payload)
                }).then((response) => {
                    let message;

                    if (response.status === 204) {
                        const cmp = meta.version.compareTo(privates.get(this).meta.version);

                        if (cmp > 0) { // upgrade
                            message = utils.gettext("The %(type)s was upgraded to v%(version)s successfully.");
                        } else if (cmp < 0) { // downgrade
                            message = utils.gettext("The %(type)s was downgraded to v%(version)s successfully.");
                        } else { // same version
                            // From/to a -dev version
                            message = utils.gettext("The %(type)s was replaced using v%(version)s successfully.");
                        }
                        message = utils.interpolate(message, {
                            type: this.meta.type,
                            version: meta.version.text
                        });

                        return change_meta.call(this, meta).then(() => {
                            this.logManager.log(message, Wirecloud.constants.LOGGING.INFO_MSG);
                        });
                    } else {
                        return Promise.reject(new Error("Unexpected response from server"));
                    }
                });
            }
        }

    }

})(Wirecloud, StyledElements, StyledElements.Utils);
