import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.ACTIVITY_REVIEW_PORT||4288);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8'};
// 独立静态预览只监听本机，并将文件请求限制在原型目录内。
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const evidence=url.pathname.startsWith('/evidence/');const base=evidence?resolve(root,'../../../artifacts/activity-review'):root;const relative=evidence?url.pathname.slice('/evidence'.length):url.pathname==='/'?'/index.html':url.pathname;const file=resolve(base,'.'+decodeURIComponent(relative));if(file!==base&&!file.startsWith(base+sep)){res.writeHead(403).end();return;}const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Activity-Review':'prototype'});res.end(body);}catch{res.writeHead(404).end('Not found');}});
server.on('error',error=>{console.error('原型预览启动失败：'+error.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(`Activity review: http://127.0.0.1:${port}`));
