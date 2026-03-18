const API = (() => {
  const BASE = window.location.origin;
  function getToken() { return localStorage.getItem('ow_token'); }

  async function req(method, path, body, isForm) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, {
      method, headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    // Auth
    register: (d) => req('POST', '/api/auth/register', d),
    login:    (d) => req('POST', '/api/auth/login', d),
    me:       ()  => req('GET',  '/api/auth/me'),
    // Users
    searchUsers:   (q) => req('GET', `/api/users/search?q=${encodeURIComponent(q)}`),
    getUser:       (id) => req('GET', `/api/users/${id}`),
    updateProfile: (d) => req('PATCH', '/api/users/me', d),
    // Contacts
    getContacts: ()      => req('GET',  '/api/contacts'),
    addContact:  (uid)   => req('POST', '/api/contacts', { user_id: uid }),
    // Chats
    getChats:       ()         => req('GET',  '/api/chats'),
    openDirect:     (user_id)  => req('POST', '/api/chats/direct', { user_id }),
    createGroup:    (d)        => req('POST', '/api/chats/group', d),
    getChatMembers: (id)       => req('GET',  `/api/chats/${id}/members`),
    addMember:      (cid, uid) => req('POST', `/api/chats/${cid}/members`, { user_id: uid }),
    // Messages
    getMessages: (cid, limit=50, offset=0) => req('GET', `/api/chats/${cid}/messages?limit=${limit}&offset=${offset}`),
    sendMessage: (cid, d)  => req('POST',   `/api/chats/${cid}/messages`, d),
    editMessage: (id, c)   => req('PATCH',  `/api/messages/${id}`, { content: c }),
    deleteMessage: (id)    => req('DELETE', `/api/messages/${id}`),
    markRead:    (id)      => req('POST',   `/api/messages/${id}/read`),
    // Upload
    upload: (file) => { const f = new FormData(); f.append('file', file); return req('POST', '/api/upload', f, true); },
    // Admin
    getInvites:    ()       => req('GET',    '/api/admin/invites'),
    createInvite:  (d)      => req('POST',   '/api/admin/invites', d),
    deleteInvite:  (id)     => req('DELETE', `/api/admin/invites/${id}`),
    getAdminUsers: ()       => req('GET',    '/api/admin/users'),
    removeUser:    (id)     => req('DELETE', `/api/admin/users/${id}`),
  };
})();
