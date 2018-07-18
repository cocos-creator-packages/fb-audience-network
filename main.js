'use strict';
const Path = require('fire-path');
const Fs = require('fire-fs');
const xml2js = require("xml2js");
const xcode = require('xcode');
const plist = require('plist');
const spawnSync = require('child_process').spawnSync;
const spawn = require('child_process').spawn;

/**
 * 添加 facebook audience network 的 sdk 到 android 工程
 * @param options
 * @returns {Promise}
 */
function _handleAndroid(options) {
    return new Promise((resolve, reject) => {

        //修改build.gradle文件
        let buildGradle = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/build.gradle');
        if (Fs.existsSync(buildGradle)) {
            let content = Fs.readFileSync(buildGradle, 'utf-8');

            content = content.replace(/dependencies\s*\{[^\}]+}/, (str) => {
                if (str.indexOf('audience-network-sdk') != -1) return str;

                let substr = str.substr(0, str.length - 1);
                substr += "    implementation 'com.facebook.android:audience-network-sdk:4.99.0'";
                substr += "\n}";
                return substr;
            });
            Fs.writeFileSync(buildGradle, content);
        } else {
            Editor.error('cant find build.gradle at ', buildGradle);
            reject();
            return;
        }

        //拷贝android文件
        let srcAndroidPath = Editor.url('packages://fb-audience-network/libs/android');
        let destAndroidPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/src/org/cocos2dx/javascript');
        if (!Fs.existsSync(Path.join(destAndroidPath, "FacebookAN.java"))) {
            Fs.copySync(srcAndroidPath, destAndroidPath);
        }


        _copyFsupportFile(options);

        resolve();
    });
}

function _copyFsupportFile(options){
    //拷贝脚本文件
    let srcJsPath = Editor.url('packages://fb-audience-network/libs/js');
    let destJsPath = Path.join(options.dest, 'src');
    Fs.copySync(srcJsPath, destJsPath);

    let mainPath = Path.join(options.dest, 'main.js');
    let mainFile = Fs.readFileSync(mainPath, 'utf-8');

    //找到window.jsb里面的内容，在boot()前面插入CCads的require的引用
    if (mainFile.indexOf('CCAds.js') == -1) {
        mainFile = mainFile.replace(/if\s*\(window.jsb\)\s*\{[^\}]+}/, (str) => {
            str = str.replace(/boot\(\)/, (sub) => {
                return "require('src/CCAds.js')\n        " + sub;
            });
            return str;
        });
        Fs.writeFileSync(mainPath, mainFile);
    }
}
/**
 * 添加 facebook live stream 的 sdk 到 iOS 工程
 * @param options
 * @returns {Promise}
 */
function _handleIOS(options) {
    console.log("fb-audience-network handle ios");
    return new Promise((resolve, reject) => {
        //第一步，判断是否安装pod 命令
        let podCheck = spawnSync('pod');
        if (podCheck.error) {
            Editor.error('Can\'t find pod command , please install CocoaPods (https://cocoapods.org/)');
            reject(error);
            return;
        }

        _copyFsupportFile(options);

        //第二步，创建Podfile文件
        let podPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/Podfile');
        let targetName = `${options.projectName}-mobile`;
        if (!Fs.existsSync(podPath)) {
            let podTemplate = Fs.readFileSync(Editor.url('packages://fb-audience-network/libs/ios/Podfile'), 'utf-8');
            podTemplate = podTemplate.replace(/(%[s])/g, targetName);
            Fs.writeFileSync(podPath, podTemplate);

            //第三步，执行pod install命令，
            console.log("cwd is ", Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/'));
            let genPod = spawn('pod', ['install'], {cwd: Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/')});

            genPod.stdout.on("data", (data) => {
                Editor.log('Audience Network:' + data.toString());
            });

            genPod.stderr.on("data", (data) => {
                Editor.error('Audience Network:' + data.toString());
            });

            genPod.on("error", (data) => {
                reject(data.toString());
            });

            genPod.on("close", (code) => {
                if (code !== 0) {
                    reject(code);
                }
                resolve();
            });
            return;
        }

        //todo:如果已经存在这个文件，要考虑是否自己在往上面加上AN的framework，目前先跳过
        Editor.log('Podfile already exist skip...');
        resolve();
    });
}

function handleEvent(options, cb) {
    let handle = Promise.resolve();
    let config = Editor._projectProfile.data['facebook'];

    console.log("an handleEvent ---------", config);
    if (!config.enable || !config.audience.enable) {
        cb && cb();
        return;
    }

    //progress.push(audience.handleAudience(options));
    if (options.actualPlatform.toLowerCase() === 'android') {
        handle = _handleAndroid(options);
    } else if (options.actualPlatform.toLowerCase() === "ios") {
        handle = _handleIOS(options);
    }

    handle.then(() => {
        cb && cb();
    }).catch((e) => {
        cb && cb();
    });
}

module.exports = {
    load() {
        Editor.Builder.on('before-change-files', handleEvent);
    },

    unload() {
        Editor.Builder.removeListener('before-change-files', handleEvent);
    },

    messages: {}
};
