'use strict';
const UI = (() => {
  const COLORS = ['#E50914','#1D9BF0','#00BA7C','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316'];
  function colorForName(n){if(!n)return COLORS[0];let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))&0xffffffff;return COLORS[Math.abs(h)%COLORS.length];}
  function initials(n){if(!n)return'?';const p=n.trim().split(/\s+/);return(p.length>1?(p[0][0]+p[p.length-1][0]):n.slice(0,2)).toUpperCase();}
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function linkify(t){if(!t)return'';return esc(t).replace(/(https?:\/\/[^\s<>"]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');}
  function fmtTime(ts){if(!ts)return'';return new Date(Number(ts)).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
  function fmtDate(ts){if(!ts)return'';const d=new Date(Number(ts)),now=new Date(),diff=(now-d)/86400000;if(diff<1)return fmtTime(ts);if(diff<2)return'Yesterday';if(diff<7)return d.toLocaleDateString([],{weekday:'short'});return d.toLocaleDateString([],{day:'2-digit',month:'2-digit'});}
  function fmtFullDate(ts){if(!ts)return'Today';const d=new Date(Number(ts)),now=new Date(),diff=Math.floor((now-d)/86400000);if(diff===0)return'Today';if(diff===1)return'Yesterday';return d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'});}
  function lastSeen(ts){if(!ts||ts===-1)return'online';const diff=Date.now()-Number(ts)*1000;if(diff<60000)return'just now';if(diff<3600000)return`${Math.floor(diff/60000)}m ago`;if(diff<86400000)return`${Math.floor(diff/3600000)}h ago`;return new Date(ts*1000).toLocaleDateString();}
  function avatarHTML(name,avatar,size=40){return`<div class="user-item-avatar" style="background:${colorForName(name)};width:${size}px;height:${size}px;min-width:${size}px">${avatar?`<img src="${esc(avatar)}" style="width:100%;height:100%;object-fit:cover">`:initials(name)}</div>`;}
  let _tt;
  function toast(msg,dur=2500){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.classList.remove('hidden');el.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),300);},dur);}
  // Dark mode by default (Netflix-style)
  function loadTheme(){const t=localStorage.getItem('ow_theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');/* else dark is :root default */}
  function setTheme(dark){if(dark)document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme','light');localStorage.setItem('ow_theme',dark?'dark':'light');}
  return{colorForName,initials,esc,linkify,fmtTime,fmtDate,fmtFullDate,lastSeen,avatarHTML,toast,loadTheme,setTheme};
})();
