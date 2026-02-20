// ==UserScript==
// @name         微博批量拉黑工具 (全功能版)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  支持全量粉丝拉黑、红V粉丝拉黑、断点续传，兼容 weibo.com 和 m.weibo.cn
// @author       User
// @match        *://weibo.com/*
// @connect      weibo.com
// @connect      m.weibo.cn
// @grant        GM_xmlhttpRequest
// ==/UserScript==


(function () {
    // ================= 配置与全局状态 =================
    window.allDogs = [];
    window.isStopRequested = false;

    // ================= UI 界面构建 =================
    function createUI() {
        if (document.getElementById('weibo-blocker-ui')) return;

        const uiHtml = `
            <div id="weibo-blocker-ui" style="position: fixed; bottom: 20px; right: 20px; width: 320px; background: #2c2f33; color: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: sans-serif; z-index: 999999; overflow: hidden; border: 1px solid #444;">
                <div style="padding: 10px 15px; background: #23272a; border-bottom: 1px solid #1a1a1a; display: flex; justify-content: space-between; align-items: center;">
                    <b style="font-size:14px;">🛠 微博批量拉黑工具</b>
                    <button id="wb-close-btn" style="background: none; border: none; color: #ff5f56; font-size: 16px; cursor: pointer; font-weight: bold;">×</button>
                </div>
                <div style="padding: 15px;">
                    <label style="font-size: 12px; color: #ccc;">目标微博 UID:</label>
                    <input type="text" id="wb-target-uid" placeholder="例如: 2303645815" style="width: 100%; padding: 8px; margin: 5px 0 10px; box-sizing: border-box; background: #40444b; border: 1px solid #202225; color: #fff; border-radius: 4px;">

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                        <button id="wb-btn-all" style="padding: 8px; background: #7289da; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">拉黑所有粉丝</button>
                        <button id="wb-btn-resume" style="padding: 8px; background: #43b581; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">断点继续拉黑</button>
                        <button id="wb-btn-stop" style="padding: 8px; background: #f04747; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">⛔ 停止执行</button>
                    </div>

                    <div id="wb-log-box" style="height: 150px; background: #1e2124; border: 1px solid #202225; border-radius: 4px; padding: 8px; font-size: 11px; overflow-y: auto; color: #aaa; font-family: monospace;">
                        准备就绪。请输入 UID 后点击操作...<br>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', uiHtml);

        // 绑定事件
        document.getElementById('wb-close-btn').onclick = () => document.getElementById('weibo-blocker-ui').remove();
        document.getElementById('wb-btn-all').onclick = () => startTask('all');
        document.getElementById('wb-btn-5000').onclick = () => startTask('5000');
        document.getElementById('wb-btn-resume').onclick = () => startTask('resume');
        document.getElementById('wb-btn-stop').onclick = () => {
            window.isStopRequested = true;
            addLog("🔴 已触发停止指令，等待当前请求完成后退出...", "red");
        };
    }

    // 打印日志到悬浮窗
    function addLog(msg, color = "#aaa") {
        const logBox = document.getElementById('wb-log-box');
        if (!logBox) return;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        logBox.innerHTML += `<span style="color:${color}">[${time}] ${msg}</span><br>`;
        logBox.scrollTop = logBox.scrollHeight; // 自动滚动到底部
        console.log(msg); // 同步输出到控制台
    }

    // ================= 核心网络逻辑 =================
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function makeRequest(url, method = 'GET', body = null, headers = {}) {
        try {
            const response = await fetch(url, { method, headers, body });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            addLog(`请求失败: ${error.message}`, "red");
            return null;
        }
    }

    async function getTotalPages(uid, pageSize) {
        const url = `https://weibo.com/ajax/user/popcard/get?id=${uid}`;
        const data = await makeRequest(url);
        if (data && data.data) {
            const followersCount = parseInt(data.data.followers_count_str, 10);
            return Math.ceil(followersCount / pageSize);
        }
        return 0;
    }

    async function fetchPage(uid, page) {
        const url = `https://weibo.com/ajax/friendships/friends?relate=fans&page=${page}&uid=${uid}&type=fans&newFollowerCount=0`;
        const data = await makeRequest(url);
        if (data && data.users && data.users.length > 0) {
            addLog(`成功获取第 ${page} 页粉丝数据`, "#43b581");
            return data.users;
        } else {
            addLog(`第 ${page} 页为空，可能是防抓取限制`, "#f2a65a");
            return [];
        }
    }

    async function fetchPage5000(uid, page) {
        const since = page * 20;
        const url = `https://m.weibo.cn/api/container/getIndex?containerid=231051_-_fans_-_${uid}&since_id=${since}`;
        const data = await makeRequest(url);
        if (data && data?.data?.cards && data.data.cards.length > 0) {
            addLog(`成功获取第 ${page} 页红V粉丝数据`, "#43b581");
            return data.data.cards.map(e => e.card_group).flat().filter(e => e.buttons).map(e => e.buttons).flat().map(e => e.params.uid);
        }
        return [];
    }

    async function fetchAllFans(uid) {
        const pageSize = 20;
        const totalPages = await getTotalPages(uid, pageSize);
        addLog(`=== 开始获取所有粉丝，共预计 ${totalPages} 页 ===`, "white");
        if (totalPages === 0) return [];

        let allFans = [];
        for (let page = 0; page <= totalPages; page++) {
            if (window.isStopRequested) break;
            const fans = await fetchPage(uid, page);
            allFans = allFans.concat(fans.map(e => e.id));
            await delay(500); // 避免渣浪制裁
        }
        allFans.push(uid); // 把博主自己也加进去
        addLog(`获取完成，共解析到 ${allFans.length} 个账号`, "#7289da");
        return allFans;
    }

    async function fetch5000Fans(uid) {
        const totalPages = 250;
        addLog(`=== 开始获取前5000粉丝，预计 250 页 ===`, "white");
        let allFans = [];
        for (let page = 0; page <= totalPages; page++) {
            if (window.isStopRequested) break;
            const fans = await fetchPage5000(uid, page);
            allFans = allFans.concat(fans);
            await delay(300);
        }
        allFans.push(uid);
        addLog(`获取完成，共解析到 ${allFans.length} 个账号`, "#7289da");
        return allFans;
    }

    // 修复后的拉黑函数 (使用微博标准的 AJAX 拉黑接口)
    async function blockDog(userId) {
        const url = 'https://weibo.com/aj/filter/block?ajwvr=6';
        const body = `uid=${userId}&filter_type=1&status=1&interact=1&follow=1`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest' // 欺骗防爬
                },
                body: body
            });
            const data = await response.json();
            if (data.code === '100000') {
                addLog(`[+] 成功拉黑: ${userId}`, "#43b581");
            } else {
                addLog(`[-] 拉黑失败 ${userId}: ${data.msg}`, "#f2a65a");
            }
        } catch (error) {
            addLog(`[x] 请求拉黑出错: ${userId}`, "red");
        }
    }

    async function mainBlockList(uids) {
        window.allDogs = uids;
        addLog(`--- 开始执行拉黑队列，共计 ${uids.length} 个 ---`, "white");
        for (let index = 0; index < uids.length; index++) {
            if (window.isStopRequested) {
                addLog(`⚠ 已手动终止拉黑进程。当前进度: ${index}/${uids.length}`, "red");
                break;
            }
            const userId = uids[index];
            addLog(`正在拉黑进度: [${index + 1}/${uids.length}] UID: ${userId}`);
            await blockDog(userId);
            await delay(500); // 延迟0.5秒
        }
        if (!window.isStopRequested) addLog("✅ 队列执行完毕！", "#43b581");
    }

    // ================= 任务调度入口 =================
    async function startTask(type) {
        window.isStopRequested = false; // 重置停止状态
        const uidInput = document.getElementById('wb-target-uid').value.trim();

        if (type !== 'resume' && !uidInput) {
            alert('请先输入目标的微博 UID！');
            return;
        }

        try {
            document.getElementById('wb-log-box').innerHTML = ''; // 清空日志
            if (type === 'all') {
                const uids = await fetchAllFans(uidInput);
                if (uids.length > 0) await mainBlockList(uids);
            }
            else if (type === '5000') {
                const uids = await fetch5000Fans(uidInput);
                if (uids.length > 0) await mainBlockList(uids);
            }
            else if (type === 'resume') {
                if (!window.allDogs || window.allDogs.length === 0) {
                    addLog("没有找到上次的拉黑记录，无法断点续传。", "red");
                    return;
                }
                const resumeUid = prompt("请输入上次失败/卡住时的 UID（留空则从头开始）：");
                let uidsToBlock = window.allDogs;
                if (resumeUid) {
                    const idx = window.allDogs.indexOf(resumeUid);
                    if (idx !== -1) {
                        uidsToBlock = window.allDogs.slice(idx);
                        addLog(`从 ${resumeUid} 处恢复拉黑...`, "white");
                    } else {
                        addLog("未能在记录中找到该 UID，默认从头开始。", "red");
                    }
                }
                await mainBlockList(uidsToBlock);
            }
        } catch (error) {
            addLog(`发生致命错误: ${error.message}`, "red");
            console.error(error);
        }
    }

    // 启动 UI
    createUI();
})();

