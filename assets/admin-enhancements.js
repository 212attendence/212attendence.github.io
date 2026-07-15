(function(window){
  "use strict";

  function ensureResilience(){
    if(window.AttendanceFailover||document.querySelector('script[src*="/assets/resilience.js"]'))return;
    var script=document.createElement("script");script.src="/assets/resilience.js?v=1";script.defer=true;document.head.appendChild(script);
  }
  function loadSync(src){
    try{var request=new XMLHttpRequest();request.open("GET",src,false);request.send(null);if((request.status>=200&&request.status<300)||request.status===0)window.eval(request.responseText)}catch(error){console.error("Admin extension load failed",error)}
  }
  function addLink(container,label,href,className){
    if(!container||container.querySelector('[href="'+href+'"]'))return;
    var link=document.createElement("a");link.className=className||"btn btn-soft";link.href=href;link.textContent=label;container.appendChild(link);
  }
  function setFavicon(){
    ["icon","shortcut icon","apple-touch-icon"].forEach(function(rel){var link=document.querySelector('link[rel="'+rel+'"]')||document.createElement("link");link.rel=rel;link.href="/favicon.png?v=31";if(rel!=="shortcut icon")link.sizes="300x300";if(!link.parentNode)document.head.appendChild(link)});
  }
  function enhanceDashboard(){
    if(location.pathname.indexOf("/admin/dashboard/")<0)return;
    var actions=document.querySelector(".actions");
    addLink(actions,"앱 배포","/admin/app-release/","btn btn-soft");
    addLink(actions,"시스템 상태","/admin/system-health/","btn btn-soft");
    addLink(actions,"개인정보 권한","/admin/privacy-permissions/","btn btn-soft");
  }
  function enhanceAccounts(){
    if(location.pathname!=="/accounts-s/"&&location.pathname!=="/accounts-s/index.html")return;
    var actions=document.querySelector(".top-actions");
    addLink(actions,"앱 배포","/admin/app-release/","btn btn-soft");
    loadSync("/assets/accounts-password-post.js?v=1");
  }
  document.addEventListener("DOMContentLoaded",function(){setFavicon();ensureResilience();enhanceDashboard();enhanceAccounts()});
})(window);
