const { getPackages } = require('./common');
const fs = require('fs')
const { execSync } = require('child_process');
const { gt, prerelease } = require('semver')
const latest = require('latest-version')

function getVersion(name, isNext) {
  if (isNext) {
    return latest(name, { version: 'next' }).catch(() => getVersion(name))
  } else {
    return latest(name).catch(() => '0.0.0')
  }
}

function isNext(version) {
  const parts = prerelease(version)
  if (!parts) return false
  return parts[0] !== 'rc'
}
(async ()=>{
  for(const root of getPackages()){
    const meta=require(root+'/package.json')
    const backupPackageJson=fs.readFileSync(root+'/package.json', 'utf8')
    const newPackageJson=JSON.parse(backupPackageJson.replace(/workspace:latest/g,'latest'))
    Object.keys(newPackageJson.peerDependencies||{}).forEach(key=>{
      if(newPackageJson.dependencies[key]) delete newPackageJson.dependencies[key]
    })

    const current = await getVersion(meta.name, isNext(meta.version)) // 获取最新版本号
    if (gt(meta.version, current)) {
      fs.writeFileSync(root+'/package.json', JSON.stringify(newPackageJson,null,2))
      console.log(`start publish ${meta.name}@${meta.version}`)
      execSync(`npm publish --access public --tag ${isNext(meta.version) ? 'next' : 'latest'}`,{
        cwd:root,
        encoding:'utf8'
      })
      fs.writeFileSync(root+'/package.json', backupPackageJson)
    }else {
      console.log(`${meta.name}@${meta.version} no change, skip`)
    }
  }
})()

