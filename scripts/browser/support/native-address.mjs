import {execFileSync} from 'node:child_process';

// Optional headed macOS verification. Inspect only Chrome for Testing, never
// the user's Chrome process. Web-document/CDP URLs do not prove omnibox state.
export function readNativeAddress() {
  if (process.platform !== 'darwin') throw Error('Native address verification requires macOS.');
  const script = `
const process=Application('System Events').processes.byName('Google Chrome for Testing');
function find(node,depth){
  if(depth>12)return null;
  try{
    const role=node.role();if(role==='AXWebArea')return null;
    if(role==='AXTextField')return node.value();
    for(const child of node.uiElements()){const result=find(child,depth+1);if(result!==null)return result;}
  }catch{}
  return null;
}
JSON.stringify(process.exists()?find(process.windows[0],0):null);`;
  const address=JSON.parse(execFileSync('osascript',['-l','JavaScript','-e',script],{encoding:'utf8',timeout:15000}));
  if(typeof address!=='string')throw Error('Chrome for Testing address field unavailable.');
  return address;
}
