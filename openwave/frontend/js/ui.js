'use strict';
const UI = (() => {
  const COLORS = ['#7C3AED','#2563EB','#059669','#D97706','#DC2626','#7C3AED','#0891B2','#9333EA'];
  function colorForName(n){if(!n)return COLORS[0];let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))&0xffffffff;return COLORS[Math.abs(h)%COLORS.length];}
  function initials(n){if(!n)return'?';const p=n.trim().split(/\s+/);return p.length>1?(p[0][0]+p[p.length-1][0]).toUpperCase():n.slice(0,2).toUpperCase();}
  function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function linkify(t){if(!t)return'';return esc(t).replace(/(https?:\/\/[^\s<>"]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');}
  function fmtTime(ts){if(!ts)return'';const d=new Date(Number(ts));return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
  function fmtDate(ts){if(!ts)return'';const d=new Date(Number(ts)),now=new Date();const diff=(now-d)/86400000;if(diff<1)return fmtTime(ts);if(diff<2)return'Yesterday';if(diff<7)return d.toLocaleDateString([],{weekday:'short'});return d.toLocaleDateString([],{day:'2-digit',month:'2-digit'});}
  function fmtFullDate(ts){if(!ts)return'Today';const d=new Date(Number(ts)),now=new Date();const diff=Math.floor((now-d)/86400000);if(diff===0)return'Today';if(diff===1)return'Yesterday';return d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'});}
  function lastSeen(ts){if(!ts||ts===-1)return'online';const diff=Date.now()-Number(ts)*1000;if(diff<60000)return'just now';if(diff<3600000)return`${Math.floor(diff/60000)}m ago`;if(diff<86400000)return`${Math.floor(diff/3600000)}h ago`;return new Date(ts*1000).toLocaleDateString();}
  function avatarHTML(name,avatar,size=40){return`<div class="user-item-avatar" style="background:${colorForName(name)};width:${size}px;height:${size}px">${avatar?`<img src="${esc(avatar)}" style="width:100%;height:100%;object-fit:cover">`:initials(name)}</div>`;}
  let toastTimer;
  function toast(msg,dur=2500){const el=document.getElementById('toast');el.textContent=msg;el.classList.remove('hidden');el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),300);},dur);}
  function loadTheme(){const t=localStorage.getItem('ow_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark');}
  function setTheme(dark){document.documentElement.setAttribute('data-theme',dark?'dark':'light');localStorage.setItem('ow_theme',dark?'dark':'light');}
  return{colorForName,initials,esc,linkify,fmtTime,fmtDate,fmtFullDate,lastSeen,avatarHTML,toast,loadTheme,setTheme};
})();
