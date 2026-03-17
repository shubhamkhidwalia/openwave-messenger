/**
 * OpenWave UI Utilities
 */
const UI = (() => {

  const COLORS = [
    '#E57373','#F06292','#CE93D8','#9FA8DA',
    '#4FC3F7','#4DB6AC','#81C784','#FFD54F',
    '#FF8A65','#A1887F','#90A4AE','#2AABEE'
  ];

  function colorForName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarEl(name, src, size = 40) {
    const el = document.createElement('div');
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.38)}px;color:#fff;background:${colorForName(name)};overflow:hidden;flex-shrink:0;`;
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onerror = () => { img.remove(); el.textContent = initials(name); };
      el.appendChild(img);
    } else {
      el.textContent = initials(name);
    }
    return el;
  }

  function avatarHTML(name, src, size = 40) {
    const bg = colorForName(name);
    const fs = Math.round(size * 0.38);
    if (src) {
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;background:${bg}"><img src="${src}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentNode.innerHTML='${initials(name)}'"></div>`;
    }
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${fs}px;color:#fff;background:${bg};flex-shrink:0">${initials(name)}</div>`;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return fmtTime(ts);
    if (diff < 7 * 86400) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function fmtFullDate(ts) {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function lastSeen(ts) {
    if (!ts || ts === -1) return 'online';
    if (ts === 0) return 'last seen a long time ago';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'last seen just now';
    if (diff < 3600) return `last seen ${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `last seen ${Math.floor(diff/3600)}h ago`;
    const d = new Date(ts * 1000);
    return 'last seen ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function linkify(str) {
    return esc(str).replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>'
    );
  }

  function toast(msg, dur = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.classList.add('hidden'),300); }, dur);
  }

  function setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
    localStorage.setItem('ow_theme', dark ? 'dark' : 'light');
  }

  function loadTheme() {
    const saved = localStorage.getItem('ow_theme');
    if (saved) setTheme(saved === 'dark');
    else setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  return { colorForName, initials, avatarEl, avatarHTML, fmtTime, fmtDate, fmtFullDate, lastSeen, esc, linkify, toast, setTheme, loadTheme };
})();
