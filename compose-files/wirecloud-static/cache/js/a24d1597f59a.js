Downcoder.map={};Downcoder.chars=[];for(var i=0;i<ALL_DOWNCODE_MAPS.length;i++){var lookup=ALL_DOWNCODE_MAPS[i];for(var c in lookup){if(lookup.hasOwnProperty(c)){Downcoder.map[c]=lookup[c];}}}
for(var k in Downcoder.map){if(Downcoder.map.hasOwnProperty(k)){Downcoder.chars.push(k);}}
Downcoder.regex=new RegExp(Downcoder.chars.join('|'),'g');}};function downcode(slug){Downcoder.Initialize();return slug.replace(Downcoder.regex,function(m){return Downcoder.map[m];});}
function URLify(s,num_chars,allowUnicode){if(!allowUnicode){s=downcode(s);}
var removelist=["a","an","as","at","before","but","by","for","from","is","in","into","like","of","off","on","onto","per","since","than","the","this","that","to","up","via","with"];var r=new RegExp('\\b('+removelist.join('|')+')\\b','gi');s=s.replace(r,'');if(allowUnicode){s=XRegExp.replace(s,XRegExp('[^-_\\p{L}\\p{N}\\s]','g'),'');}else{s=s.replace(/[^-\w\s]/g,'');}
s=s.replace(/^\s+|\s+$/g,'');s=s.replace(/[-\s]+/g,'-');s=s.substring(0,num_chars);s=s.replace(/-+$/g,'');return s.toLowerCase();}
window.URLify=URLify;})();