'use strict';
const Path = require('fire-path');
const Fs = require('fire-fs');
const xml2js = require("xml2js");
const xcode = require('xcode');
const plist = require('plist');
const {spawn, spawnSync} = require('child_process');

/**
 * 添加 facebook audience network 的 sdk 到 android 工程
 * @param options
 * @returns {Promise}
 */
async function _handleAndroid(options) {
    Editor.log('Audience Network--> adding Audience Network Android support');

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
        return Promise.reject();
    }

    //拷贝android文件
    let srcAndroidPath = Editor.url('packages://fb-audience-network/libs/android');
    let destAndroidPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/src/org/cocos2dx/javascript');
    if (!Fs.existsSync(Path.join(destAndroidPath, "FacebookAN.java"))) {
        Fs.copySync(srcAndroidPath, destAndroidPath);
    }

    _copyFsupportFile(options);
}

/**
 * android 和iOS 共用的资源拷贝
 * @param options
 * @private
 */
function _copyFsupportFile(options) {
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
 * 添加 facebook live stream 的 sdk 到 iOS 工程，并完成配置
 * @param options
 * @returns {Promise}
 */
async function _handleIOS(options) {
    Editor.log('Audience Network--> adding Audience Network iOS support');
    //第一步，判断是否安装pod 命令

    if (process.env.PATH.indexOf('/usr/local/bin') === -1) {
        process.env.PATH += ":/usr/local/bin";
    }
    let podCheck = spawnSync('pod');
    if (podCheck.error) {
        Editor.error('Can\'t find pod command , please install CocoaPods (https://cocoapods.org/)');
        return Promise.reject();
    }

    //第二步：拷贝必要的文件
    _copyFsupportFile(options);

    //第三步：复制FacebookAN的代码到工程，并加入引用
    let srcSupportPath = Editor.url('packages://fb-audience-network/libs/ios/support');
    let destSupportPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/ios');
    if (!Fs.existsSync(Path.join(destSupportPath, "FacebookAN.mm"))) {
        Fs.copySync(srcSupportPath, destSupportPath);
    }

    //第二步，为工程添加framework索引
    let projectPath = Path.join(options.dest, `frameworks/runtime-src/proj.ios_mac/${options.projectName}.xcodeproj/project.pbxproj`);
    if (!Fs.existsSync(projectPath)) {
        Editor.error('Can\'t find xcodeproj file at path: ', projectPath);
        return Promise.reject();
    }
    let project = xcode.project(projectPath);
    project.parseSync();

    let section = project.pbxNativeTargetSection();
    let targetName = `${options.projectName}-mobile`;
    let target = null;

    //先找下有没有默认的target
    for (let k in section) {
        let item = section[k];
        if (typeof item !== 'string') continue;
        if (item === targetName) {
            target = k.split("_")[0];
            break;
        }
    }

    //没有的话尝试找一下mobile的
    if (target == null) {
        for (let k in section) {
            let item = section[k];
            if (typeof item !== 'string') continue;
            if (item && item.indexOf('mobile') !== -1) {
                target = k.split("_")[0];
                break;
            }
        }
    }
    //如果依然找不到要build的target那么让用户自己去添加吧
    if (!target) {
        Editor.error('Can\'t find project target: ', targetName, 'add link libraries failed , you can add link libraries at Xcode');
    }
    let groupConfig = project.getPBXObject("PBXGroup");
    let targetGroup = null;
    for (let k in groupConfig) {
        let item = groupConfig[k];
        if (typeof item !== 'string') continue;
        if (item === 'ios') {
            targetGroup = k.split("_")[0];
            break;
        }
    }

    project.addFile('ios/FacebookAN.h', targetGroup);
    project.addSourceFile('ios/FacebookAN.mm', {
        target: target,
    }, targetGroup);

    Fs.writeFileSync(projectPath, project.writeSync());

    //第四步，创建Podfile文件
    let podPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/Podfile');
    targetName = `${options.projectName}-mobile`;
    if (!Fs.existsSync(podPath)) {
        let podTemplate = Fs.readFileSync(Editor.url('packages://fb-audience-network/libs/ios/cocoapods/Podfile'), 'utf-8');
        podTemplate = podTemplate.replace(/(%[s])/g, targetName);
        Fs.writeFileSync(podPath, podTemplate);

        //第三步，执行pod install命令，
        await _loadPodFile(options);
        return Promise.resolve();
    }

    //todo:如果已经存在这个文件，要考虑是否自己在往上面加上AN的framework，目前先跳过
    Editor.log('Podfile already exist skip create Podfile...');
}


function _loadPodFile(options) {
    return new Promise((resolve, reject) => {

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
                reject();
                return
            }
            resolve();
        });

    });
}

async function handleEvent(options, cb) {
    let config = Editor._projectProfile.data['facebook'];

    if (!config.enable || !config.audience.enable) {
        cb && cb();
    }

    if (options.actualPlatform.toLowerCase() === 'android') {
        await _handleAndroid(options);
    } else if (options.actualPlatform.toLowerCase() === "ios") {
        await _handleIOS(options);
    }
    cb && cb();
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
