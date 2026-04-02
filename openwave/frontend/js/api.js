'use strict';
const API = (() => {
  const BASE=window.location.origin;
  function tok(){return localStorage.getItem('ow_token');}
  async function req(method,path,body,isForm){
    const h={};const t=tok();if(t)h['Authorization']='Bearer '+t;if(!isForm)h['Content-Type']='application/json';
    let res;
    try{res=await fetch(BASE+path,{method,headers:h,body:body?(isForm?body:JSON.stringify(body)):undefined});}
    catch(e){const err=new Error('Network error — check your connection');err.isNetworkError=true;throw err;}
    const data=await res.json().catch(()=>({}));
    if(!res.ok){const err=new Error(data.error||'Request failed');err.status=res.status;throw err;}
    return data;
  }
  return{
    register:d=>req('POST','/api/auth/register',d),
    login:d=>req('POST','/api/auth/login',d),
    me:()=>req('GET','/api/auth/me'),
    searchUsers:q=>req('GET',`/api/users/search?q=${encodeURIComponent(q)}`),
    updateProfile:d=>req('PATCH','/api/users/me',d),
    getContacts:()=>req('GET','/api/contacts'),
    addContact:uid=>req('POST','/api/contacts',{user_id:uid}),
    blockContact:uid=>req('POST',`/api/contacts/${uid}/block`),
    getChats:()=>req('GET','/api/chats'),
    openDirect:uid=>req('POST','/api/chats/direct',{user_id:uid}),
    createGroup:d=>req('POST','/api/chats/group',d),
    deleteChat:id=>req('DELETE',`/api/chats/${id}`),
    leaveGroup:id=>req('POST',`/api/chats/${id}/leave`),
    updateChat:(id,d)=>req('PATCH',`/api/chats/${id}`,d),
    getChatMembers:id=>req('GET',`/api/chats/${id}/members`),
    addMember:(cid,uid)=>req('POST',`/api/chats/${cid}/members`,{user_id:uid}),
    getMessages:(cid,l=50,o=0)=>req('GET',`/api/chats/${cid}/messages?limit=${l}&offset=${o}`),
    sendMessage:(cid,d)=>req('POST',`/api/chats/${cid}/messages`,d),
    editMessage:(id,c)=>req('PATCH',`/api/messages/${id}`,{content:c}),
    deleteMessage:id=>req('DELETE',`/api/messages/${id}`),
    markRead:id=>req('POST',`/api/messages/${id}/read`),
    upload:file=>{const f=new FormData();f.append('file',file);return req('POST','/api/upload',f,true);},
  };
})();
