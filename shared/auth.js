(function(global){
  'use strict';

  const KEY = 'omni_v2_superadmin_session';

  function cleanUsername(value){
    return String(value || '').trim().toLowerCase();
  }

  function userIdFor(username){
    return `user_${cleanUsername(username).replace(/[^a-z0-9]+/g, '_')}`;
  }

  function savedSession(){
    const saved = global.OmniUtils.parseJson(sessionStorage.getItem(KEY) || 'null', null);
    return saved?.role === 'superadmin' && saved.userId ? saved : null;
  }

  function saveSession(user){
    sessionStorage.setItem(KEY, JSON.stringify({userId:user.id || user.userId, username:user.username, displayName:user.displayName || user.username, role:'superadmin', at:Date.now()}));
  }

  function clearSession(){
    sessionStorage.removeItem(KEY);
  }

  async function hashPassword(password){
    const text = `omni-v2:${password || ''}`;
    if(global.crypto?.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for(let index=0; index<text.length; index++) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    return `legacy_${Math.abs(hash)}`;
  }

  async function hasActiveAdmin(){
    const users = await global.OmniDB.readOnce('users', 4200);
    return users.some(user => user.role === 'superadmin' && user.deleted !== true && user.active !== false && user.passwordHash);
  }

  async function createInitialAdmin({username, password, displayName}){
    const clean = cleanUsername(username);
    if(!clean || !password) throw new Error('Username and password are required.');
    if(await hasActiveAdmin()) throw new Error('A SuperAdmin account already exists. Sign in instead.');
    const id = userIdFor(clean);
    const existing = await global.OmniDB.get('users', id, 5000);
    if(existing && existing.deleted !== true && (existing.role !== 'superadmin' || existing.passwordHash)) throw new Error('This username already exists.');
    const user = {...existing, id, username:clean, displayName:displayName?.trim() || existing?.displayName || clean, role:'superadmin', passwordHash:await hashPassword(password), active:true, deleted:false, createdAt:existing?.createdAt || Date.now(), lastLoginAt:Date.now()};
    await global.OmniDB.put('users', id, user, {userId:id});
    try { await global.OmniDB.event('superadmin_created', 'user', id, {summary:`Initial SuperAdmin ${clean} created`, role:'superadmin'}, {userId:id}); } catch {}
    saveSession(user);
    return user;
  }

  async function login(username, password){
    const clean = cleanUsername(username);
    const id = userIdFor(clean);
    const user = await global.OmniDB.get('users', id, 8000);
    if(!user || user.deleted === true || user.active === false || user.role !== 'superadmin') throw new Error('SuperAdmin account was not found.');
    if(!user.passwordHash || user.passwordHash !== await hashPassword(password)) throw new Error('Password is incorrect.');
    const next = {...user, lastLoginAt:Date.now()};
    await global.OmniDB.patch('users', id, {lastLoginAt:next.lastLoginAt}, {userId:id});
    try { await global.OmniDB.event('superadmin_logged_in', 'user', id, {summary:`${clean} signed in`, role:'superadmin'}, {userId:id}); } catch {}
    saveSession(next);
    return next;
  }

  global.OmniAuth = { savedSession, saveSession, clearSession, hashPassword, hasActiveAdmin, createInitialAdmin, login };
})(window);
