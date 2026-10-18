'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const value = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const configPath = path.join(root, 'project.config.json');
const project = JSON.parse(fs.readFileSync(fs.existsSync(configPath) ? configPath : path.join(root, 'project.config.example.json')));
const appid = value('--appid');
const envId = value('--env');
if (appid && !/^wx[a-f0-9]{16}$/.test(appid)) throw new Error('AppID 应为 wx 开头的18位编号');
if (envId && !/^[a-zA-Z0-9_-]{1,100}$/.test(envId)) throw new Error('云环境 ID 格式无效');
if (appid) project.appid = appid;
// The IDE's unused-file filter can omit the shared dynamic detail routes from preview packages.
const completePackage = { ignoreDevUnusedFiles: false, ignoreUploadUnusedFiles: false };
project.setting = { ...project.setting, ...completePackage };
fs.writeFileSync(configPath, JSON.stringify(project, null, 2) + '\n');
const privatePath = path.join(root, 'project.private.config.json');
if (fs.existsSync(privatePath)) {
  const local = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
  local.setting = { ...local.setting, ...completePackage };
  fs.writeFileSync(privatePath, JSON.stringify(local, null, 2) + '\n');
}
// Runtime config is generated, ignored by Git. The committed default is copied from an example.
const config = { mode: envId ? 'cloud' : 'demo', envId: envId || '' };
fs.writeFileSync(path.join(root, 'miniprogram/config.js'), `module.exports = ${JSON.stringify(config, null, 2)};\n`);
console.log(`已生成本地工程配置，运行模式：${config.mode}。`);
