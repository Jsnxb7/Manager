const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const rows=[];
for(const [name,info] of Object.entries(lock.packages)){
  if(!name||info.dev)continue;
  const file=path.join(root,name,'package.json');
  if(!fs.existsSync(file))continue;
  const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
  rows.push({name:pkg.name,version:pkg.version,license:pkg.license??pkg.licenses??'Review package license file',repository:pkg.repository??null});
}
fs.writeFileSync(path.join(root,'packaging','THIRD_PARTY.json'),JSON.stringify(rows,null,2)+'\n');
console.log(`Recorded ${rows.length} runtime package license metadata entries. Distribution requires retaining their license files.`);
