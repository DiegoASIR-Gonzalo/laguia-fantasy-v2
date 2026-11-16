// Node/Vercel adapter for the same dependency-free Worker API.
import {handleApi} from '../server/api.js';
export default async function handler(req,res){
 const host=req.headers['x-forwarded-host']||req.headers.host;
 const url='https://'+host+req.url;
 const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(k==='cookie'?'; ':', '):v);
 let body;if(!['GET','HEAD'].includes(req.method)){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>25000){res.statusCode=413;res.end(JSON.stringify({error:'Solicitud demasiado grande.'}));return}chunks.push(chunk)}body=Buffer.concat(chunks)}
 const request=new Request(url,{method:req.method,headers,body,duplex:body?'half':undefined});
 const response=await handleApi(request,process.env);
 res.statusCode=response.status;for(const [k,v]of response.headers)if(k!=='set-cookie')res.setHeader(k,v);
 const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
 res.end(Buffer.from(await response.arrayBuffer()));
}
