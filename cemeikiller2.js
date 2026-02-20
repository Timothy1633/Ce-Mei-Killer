// ==UserScript==
// @name         微博点赞拉黑 (跨端修正版）
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  从 m.weibo.cn 抓取用户名，调用 weibo.com 屏蔽接口
// @author       User
// @match        https://m.weibo.cn/detail/*
// @connect      weibo.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    window.isStopRequested = false;

    // UI 构建逻辑
    function createUI() {
        if (document.getElementById('wb-shield-ui')) return;
        const uiHtml = `
            <div id="wb-shield-ui" style="position: fixed; bottom: 20px; right: 20px; width: 300px; background: #2c2f33; color: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 999999; font-family: sans-serif; border: 1px solid #444;">
                <div style="padding: 10px; background: #ff8200; border-radius: 8px 8px 0 0; font-weight: bold; display: flex; justify-content: space-between;">
                    <span>🚫 跨端拉黑工具</span>
                    <button id="wb-close-btn" style="background:none; border:none; color:white; cursor:pointer;">×</button>
                </div>
                <div style="padding: 15px;">
                    <button id="wb-btn-start" style="width: 100%; padding: 10px; background: #ff8200; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;">开始执行</button>
                    <button id="wb-btn-stop" style="width: 100%; padding: 5px; background: #444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">停止</button>
                    <div id="wb-log-box" style="height: 150px; background: #111; border: 1px solid #333; border-radius: 4px; padding: 8px; font-size: 11px; overflow-y: auto; color: #0f0; margin-top: 10px; font-family: monospace;">等待点击“开始”...</div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', uiHtml);
        document.getElementById('wb-close-btn').onclick = () => document.getElementById('wb-shield-ui').remove();
        document.getElementById('wb-btn-stop').onclick = () => { window.isStopRequested = true; addLog("🛑 正在停止..."); };
        document.getElementById('wb-btn-start').onclick = startTask;
    }

    function addLog(msg, color = "#0f0") {
        const logBox = document.getElementById('wb-log-box');
        if (!logBox) return;
        const time = new Date().toLocaleTimeString([], { hour12: false });
        logBox.innerHTML += `<div style="color:${color}">[${time}] ${msg}</div>`;
        logBox.scrollTop = logBox.scrollHeight;
    }

    const delay = ms => new Promise(res => setTimeout(res, ms));

    // 使用 GM_xmlhttpRequest 跨域发送拉黑请求
    function blockUser(uid, screenName) {
        return new Promise((resolve) => {
            const url = 'https://weibo.com/aj/filter/block?ajwvr=6';
            const body = `uid=${uid}&nickname=${encodeURIComponent(screenName)}&filter_type=1&status=1&interact=1&follow=1`;

            // 这里是报错的关键：必须确保它在 Userscript 环境下运行
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                data: body,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://weibo.com/set/shield?type=user"
                },
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.code === '100000') {
                            addLog(`[+] 屏蔽成功: ${screenName}`, "#43b581");
                        } else {
                            addLog(`[-] 失败: ${screenName} (${data.msg})`, "#f2a65a");
                        }
                    } catch (e) {
                        addLog(`[!] 解析失败: ${screenName}`, "red");
                    }
                    resolve();
                },
                onerror: () => {
                    addLog(`[x] 网络错误: ${screenName}`, "red");
                    resolve();
                }
            });
        });
    }

    async function fetchLikers(mid) {
        let page = 1;
        let userList = [];
        addLog("🔍 正在抓取点赞用户列表...");
        while (true) {
            if (window.isStopRequested) break;
            const url = `https://m.weibo.cn/api/attitudes/show?id=${mid}&page=${page}`;
            try {
                const resp = await fetch(url);
                const data = await resp.json();
                if (data.ok !== 1 || !data.data.data || data.data.data.length === 0) break;
                const pageUsers = data.data.data.map(item => ({ uid: item.user.id, name: item.user.screen_name }));
                userList = userList.concat(pageUsers);
                addLog(`已抓取第 ${page} 页 (${pageUsers.length} 人)`);
                page++;
                await delay(800);
            } catch (e) { break; }
        }
        return userList;
    }

    async function startTask() {
        window.isStopRequested = false;
        const match = window.location.pathname.match(/\/detail\/(\d+)/);
        if (!match) return alert("请在微博移动版详情页运行 (m.weibo.cn/detail/xxx)");
        const mid = match[1];

        const users = await fetchLikers(mid);
        addLog(`--- 开始执行拉黑: 共 ${users.length} 人 ---`, "white");

        for (let i = 0; i < users.length; i++) {
            if (window.isStopRequested) break;
            const user = users[i];
            addLog(`正在拉黑[${i + 1}/${users.length}]: ${user.name}`);
            await blockUser(user.uid, user.name);
            await delay(1200); // 建议间隔稍长，防止被封
        }
        addLog("✅ 处理完毕！");
    }

    setTimeout(createUI, 1000);
})();

