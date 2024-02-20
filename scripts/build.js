
const { execSync } = require('child_process');
const { getPackages } = require('./common');
for(const root of getPackages()){
  console.log(`building ${root.replace(process.cwd()+'/','')}`)
  const result=execSync(`npm run build`,{
    cwd:root,
    encoding:'utf8'
  })
  result && console.log(result)
}
