/* utils.js — jsmediatags reader and small utility functions */

export async function readTags(blob){
  return new Promise(resolve => {
    if(!window.jsmediatags) return resolve({});
    try {
      jsmediatags.read(blob, {
        onSuccess: x => {
          let cover = '';
          try {
            const p = x.tags?.picture;
            if(p){
              const bytes = new Uint8Array(p.data);
              let binary = '';
              for(let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              cover = `data:${p.format};base64,${btoa(binary)}`;
            }
          } catch {}
          resolve({title: x.tags?.title || '', artist: x.tags?.artist || '', album: x.tags?.album || '', cover});
        },
        onError: () => resolve({})
      });
    } catch { resolve({}); }
  });
}
