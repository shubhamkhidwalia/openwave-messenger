'use strict';
const API = (() => {
  function tok(){return localStorage.getItem('ow_token');}
  async function req(method,path,body,isForm){
    const h={};const t=tok();if(t)h['Authorization']='Bearer '+t;
    if(!isForm)h['Content-Type']='application/json';
    let res;
    try{
      res=await fetch(path,{method,headers:h,body:body?(isForm?body:JSON.stringify(body)):undefined});
    }catch(e){const err=new Error('No connection. Check your internet.');err.offline=true;throw err;}
    const data=await res.json().catch(()=>({}));
    if(!res.ok){const err=new Error(data.error||'Request failed');err.status=res.status;throw err;}
    return data;
  }
  return{
    register:d=>req('POST','/api/auth/register',d),
    login:d=>req('POST','/api/auth/login',d),
    me:()=>req('GET','/api/auth/me'),
    forgotPassword:u=>req('POST','/api/auth/forgot-password',{username:u}),
    resetPassword:(token,user_id,new_password)=>req('POST','/api/auth/reset-password',{token,user_id,new_password}),
    searchUsers:q=>req('GET',`/api/users/search?q=${encodeURIComponent(q)}`),
    updateProfile:d=>req('PATCH','/api/users/me',d),
    getContacts:()=>req('GET','/api/contacts'),
    addContact:uid=>req('POST','/api/contacts',{user_id:uid}),
    blockContact:uid=>req('POST',`/api/contacts/${uid}/block`),
    getChats:()=>req('GET','/api/chats'),
    openDirect:uid=>req('POST','/api/chats/direct',{user_id:uid}),
    createGroup:d=>req('POST','/api/chats/group',d),
    updateChat:(id,d)=>req('PATCH',`/api/chats/${id}`,d),
    deleteChat:id=>req('DELETE',`/api/chats/${id}`),
    leaveGroup:id=>req('POST',`/api/chats/${id}/leave`),
    getChatMembers:id=>req('GET',`/api/chats/${id}/members`),
    getMessages:(id,l=50,o=0)=>req('GET',`/api/chats/${id}/messages?limit=${l}&offset=${o}`),
    sendMessage:(id,d)=>req('POST',`/api/chats/${id}/messages`,d),
    editMessage:(id,c)=>req('PATCH',`/api/messages/${id}`,{content:c}),
    deleteMessage:id=>req('DELETE',`/api/messages/${id}`),
    markRead:id=>req('POST',`/api/messages/${id}/read`),
    upload:f=>{const fd=new FormData();fd.append('file',f);return req('POST','/api/upload',fd,true);},
  };
})();
