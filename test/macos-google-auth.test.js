import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { requireDesktopUser } from '../server/auth/desktop.js';
import { API_DEPENDENCIES, desktopAuthContext } from '../server/routes/context.js';
import { resolveChatRole } from '../server/models.js';
import { DESKTOP_ONLY_MODELS } from '../server/providers.js';
import { desktopChatConfig, handleDesktopConsent, handleDesktopMe, validatedChatBody, fundDesktopChat } from '../server/routes/desktop.js';

const userID='00000000-0000-4000-8000-000000000001';
const jwt=claims=>`x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
const config=()=>loadConfig({SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',DESKTOP_OAUTH_ENABLED:'true',SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID:'windows-client',DESKTOP_CHAT_RESERVATION_CREDITS:'1'});
const request=(claims={sub:userID,session_id:'session',amr:[{method:'oauth'}]})=>({headers:{authorization:`Bearer ${jwt(claims)}`,'x-klui-client':'klui-desktop-macos'},signal:new AbortController().signal});

// The real verifier checks /auth/v1/user; a decoded JWT alone is never sufficient.
test('macOS Google session is verified by Supabase and retains the exact account ID',async()=>{
  const original=globalThis.fetch;let verified;
  globalThis.fetch=async (url,options)=>{verified={url,options};return new Response(JSON.stringify({id:userID,email:'user@klui.ai',app_metadata:{providers:['google']}}));};
  try {
    const user=await requireDesktopUser(request(),config());
    assert.equal(user.id,userID);assert.equal(user.oauthClientId,'klui-desktop-macos');assert.equal(user.identityMode,'direct_supabase');
    assert.equal(verified.url,'https://project.supabase.co/auth/v1/user');
    assert.equal(verified.options.headers.authorization,request().headers.authorization);
    await assert.rejects(requireDesktopUser(request({sub:'other',session_id:'session'}),config()),/verified Google session/);
    await assert.rejects(requireDesktopUser(request({sub:userID,amr:[{method:'oauth'}]}),config()),/verified Google session/);
    // A Google-linked account that signed in with its password is not a Google session.
    await assert.rejects(requireDesktopUser(request({sub:userID,session_id:'session',amr:[{method:'password'}]}),config()),/verified Google session/);
    await assert.rejects(requireDesktopUser(request({sub:userID,session_id:'session',client_id:'wrong-client'}),config()),/desktop session/);
    await assert.rejects(requireDesktopUser(request(),{...config(),desktop:{...config().desktop,macosGoogleEnabled:false}}),/desktop session/);
  } finally {globalThis.fetch=original;}
});

test('forged tokens and user-editable metadata cannot grant desktop Google access',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('{}',{status:401});
    await assert.rejects(requireDesktopUser(request(),config()),/expired/);
    globalThis.fetch=async()=>new Response(JSON.stringify({id:userID,user_metadata:{providers:['google']},app_metadata:{providers:['email']}}));
    await assert.rejects(requireDesktopUser(request(),config()),/verified Google session/);
  } finally {globalThis.fetch=original;}
});

test('mobile-style sessions use the existing profile without linking by email',async()=>{
  let profileID;
  const db={upsertProfile:async identity=>{profileID=identity.id;return {id:identity.id};},getAccountIdentity:()=>assert.fail('must not create a separate identity mapping')};
  const cfg={...config(),[API_DEPENDENCIES]:{createDb:()=>db,createR2:()=>({}),verifyDesktopUser:async()=>({id:userID,email:'user@klui.ai',identityMode:'direct_supabase',oauthClientId:'klui-desktop-macos'})}};
  const context=await desktopAuthContext(request(),cfg);
  assert.equal(context.user.id,userID);assert.equal(profileID,userID);
});

test('macOS consent is explicit, versioned and scoped to the same account',async()=>{
  const saved=[];const cfg={...config(),[API_DEPENDENCIES]:{createDb:()=>({upsertProfile:async()=>({id:userID}),acceptDesktopPrivacy:async value=>saved.push(value)}),createR2:()=>({}),verifyDesktopUser:async()=>({id:userID,identityMode:'direct_supabase',oauthClientId:'klui-desktop-macos'})}};
  const req=body=>({...request(),method:'POST',headers:{...request().headers,'x-klui-client-version':'0.1.0','x-klui-request-id':userID,'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
  const res={writeHead(){},end(){}};
  await assert.rejects(handleDesktopConsent(req({privacyConsent:false,policyVersion:cfg.desktop.privacyPolicyVersion}),res,cfg),/privacy notice/);
  await assert.rejects(handleDesktopConsent(req({privacyConsent:true,policyVersion:'old'}),res,cfg),/privacy notice/);
  assert.equal(saved.length,0);
  await handleDesktopConsent(req({privacyConsent:true,policyVersion:cfg.desktop.privacyPolicyVersion}),res,cfg);
  assert.deepEqual(saved,[{accountId:userID,oauthClientId:'klui-desktop-macos',policyVersion:cfg.desktop.privacyPolicyVersion}]);
});

test('macOS Haiku and explicit Luna testing retain funded ceilings; Windows stays unchanged',()=>{
  const cfg=config();const mac={user:{oauthClientId:'klui-desktop-macos'}};
  const selected=desktopChatConfig(mac,{headers:{}},cfg);
  const body=validatedChatBody({model:'klui-desktop-agent',stream:true,messages:[{role:'user',content:'Hello'}]},selected);
  assert.equal(body.model,'anthropic/claude-haiku-5.5');
  assert.deepEqual(body.provider.max_price,{prompt:0.5,completion:2.5});
  assert.ok(fundDesktopChat(body,selected)>0);
  assert.equal(desktopChatConfig(mac,{headers:{'x-klui-model':'openai/gpt-5.6-luna'}},cfg).desktop.model,'openai/gpt-5.6-luna');
  assert.throws(()=>desktopChatConfig(mac,{headers:{'x-klui-model':'arbitrary-expensive-model'}},cfg),/Unknown macOS/);
  assert.equal(desktopChatConfig({user:{oauthClientId:'klui-desktop-windows'}},{headers:{'x-klui-model':'anthropic/claude-haiku-5.5'}},cfg),cfg);
});


test('Google account reads the existing plan and settled weekly usage with computer control enabled',async()=>{
  const lookups=[];
  const cfg={...config(),[API_DEPENDENCIES]:{
    createDb:()=>({upsertProfile:async user=>({id:user.id}),getDesktopPrivacyConsent:async args=>{lookups.push(args.accountId);return {accepted:true};},getApiWeeklyUsage:async id=>{lookups.push(id);return {api_credit_used:0.2,api_credit_reserved:0.1,api_credit_limit:1};}}),
    createR2:()=>({}),verifyDesktopUser:async()=>({id:userID,email:'user@klui.ai',identityMode:'direct_supabase',oauthClientId:'klui-desktop-macos'})
  }};
  cfg.desktop.chatEnabled=true;cfg.desktop.sttEnabled=true;
  let result;const res={writeHead(){},end(body){result=JSON.parse(body);}};
  await handleDesktopMe({...request(),method:'GET',headers:{...request().headers,'x-klui-client-version':'0.1.0'}},res,cfg);
  assert.equal(result.account.id,userID);assert.equal(result.plan.name,'Pro');
  assert.equal(result.usage.used,0.2);assert.equal(result.usage.remaining,0.8);
  assert.equal(result.capabilities.chat,true);assert.equal(result.capabilities.voice,true);assert.equal(result.capabilities.computerUse,true);
  assert.deepEqual(lookups,[userID,userID]);
});

test('desktop-only models cannot be chosen from website or mobile chat',()=>{
  for (const model of DESKTOP_ONLY_MODELS) {
    let routed=[];
    try { routed=resolveChatRole({model}).models; } catch (error) { assert.match(error.message,/not approved/); }
    assert.ok(!routed.some(id=>DESKTOP_ONLY_MODELS.includes(id)));
  }
});
