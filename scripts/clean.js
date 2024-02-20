const { execSync } = require('child_process');
const { getPackages } = require('./common');
for(const root of getPackages()){
  // 创建一个 bundle
  const result=execSync(`rimraf ${root}/lib`,{
    cwd:root,
    encoding:'utf8'
  })
  result && console.log(result)
}
