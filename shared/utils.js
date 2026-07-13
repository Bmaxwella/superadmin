(function(global){
  'use strict';

  const Utils = {
    uid(prefix='id'){
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
    },
    now(){ return Date.now(); },
    esc(value){
      return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
      }[ch]));
    },
    money(value){
      return `${global.OmniConfig?.currency || 'BHD'} ${Number(value || 0).toFixed(3)}`;
    },
    cleanGun(obj){
      if(!obj || typeof obj !== 'object') return obj;
      const out = {};
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        if(key !== '_' && value !== null && typeof value !== 'object') out[key] = value;
      });
      return out;
    },
    parseJson(value, fallback){
      try {
        const parsed = JSON.parse(value || '');
        return parsed == null ? fallback : parsed;
      } catch {
        return fallback;
      }
    },
    csvEscape(value){
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
    },
    toCsv(rows){
      const list = Array.isArray(rows) ? rows : [];
      const keys = [...new Set(list.flatMap(row => Object.keys(row || {})))];
      return [keys.join(','), ...list.map(row => keys.map(key => Utils.csvEscape(row[key])).join(','))].join('\n');
    },
    fromCsv(text){
      const rows = [];
      let row = [], cell = '', quoted = false;
      const source = String(text || '').replace(/^\uFEFF/, '');
      for(let i=0; i<source.length; i++) {
        const char = source[i], next = source[i+1];
        if(char === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
        if(char === '"') { quoted = !quoted; continue; }
        if(char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
        if((char === '\n' || char === '\r') && !quoted) {
          if(char === '\r' && next === '\n') i++;
          row.push(cell); cell = '';
          if(row.some(value => value !== '')) rows.push(row);
          row = [];
          continue;
        }
        cell += char;
      }
      row.push(cell);
      if(row.some(value => value !== '')) rows.push(row);
      if(rows.length < 2) return [];
      const headers = rows.shift().map(value => String(value).trim());
      return rows.map(values => Object.fromEntries(headers.map((key, index) => {
        const value = values[index] ?? '';
        if(value === 'true') return [key, true];
        if(value === 'false') return [key, false];
        if(value !== '' && /^-?\d+(?:\.\d+)?$/.test(value)) return [key, Number(value)];
        return [key, value];
      }))).filter(record => Object.keys(record).some(key => record[key] !== ''));
    },
    downloadText(filename, text, type='text/plain'){
      const blob = new Blob([text], {type});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 500);
    },
    todayKey(ts=Date.now()){
      const parts = new Intl.DateTimeFormat('en', {timeZone:global.OmniConfig?.timeZone || 'UTC', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(ts));
      const part = type => parts.find(item => item.type === type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    },
    distanceKm(a,b){
      if(!a || !b || !a.lat || !a.lng || !b.lat || !b.lng) return Infinity;
      const R = 6371;
      const dLat = (b.lat-a.lat) * Math.PI / 180;
      const dLng = (b.lng-a.lng) * Math.PI / 180;
      const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(h));
    }
  };

  global.OmniUtils = Utils;
})(window);
