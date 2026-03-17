/**
 * OpenWave API Client
 * All HTTP calls to the backend REST API
 */
const API = (() => {
  const BASE = window.location.origin;

  function getToken() { return localStorage.getItem('ow_token'); }

  async function req(method, path, body, isForm) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isForm) headers['Content-Type'] = 'application/json';

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    // Auth
    register: (d) => req('POST', '/api/auth/register', d),
    login: (d) => req('POST', '/api/auth/login', d),
    me: () => req('GET', '/api/auth/me'),

    // Users
    searchUsers: (q) => req('GET', `/api/users/search?q=${encodeURIComponent(q)}`),
    getUser: (id) => req('GET', `/api/users/${id}`),
    updateProfile: (d) => req('PATCH', '/api/users/me', d),

    // Contacts
    getContacts: () => req('GET', '/api/contacts'),
    addContact: (user_id) => req('POST', '/api/contacts', { user_id }),

    // Chats
    getChats: () => req('GET', '/api/chats'),
    openDirect: (user_id) => req('POST', '/api/chats/direct', { user_id }),
    createGroup: (d) => req('POST', '/api/chats/group', d),
    getChatMembers: (id) => req('GET', `/api/chats/${id}/members`),
    addMember: (chat_id, user_id) => req('POST', `/api/chats/${chat_id}/members`, { user_id }),

    // Messages
    getMessages: (chat_id, limit=50, offset=0) =>
      req('GET', `/api/chats/${chat_id}/messages?limit=${limit}&offset=${offset}`),
    sendMessage: (chat_id, d) => req('POST', `/api/chats/${chat_id}/messages`, d),
    editMessage: (id, content) => req('PATCH', `/api/messages/${id}`, { content }),
    deleteMessage: (id) => req('DELETE', `/api/messages/${id}`),
    markRead: (id) => req('POST', `/api/messages/${id}/read`),

    // Upload
    upload: (file) => {
      const form = new FormData();
      form.append('file', file);
      return req('POST', '/api/upload', form, true);
    }
  };
})();
