import assert from 'node:assert/strict'
import test from 'node:test'

import { ZH } from '../src/i18n-zh.ts'

test('Chinese mode translates every remaining arcade and analysis status', () => {
  const expected = new Map([
    ['800 ms preview', '800 毫秒预览'],
    ['Analysing movement', '正在分析动作'],
    ['Analysis failed', '分析失败'],
    ['Camera did not respond — check browser permission and try again', '摄像头没有响应——请检查浏览器权限后重试'],
    ['Fast analysis unavailable', '快速分析不可用'],
    ['Movement breakdown', '动作评分明细'],
    ['Average movement match', '平均动作匹配度'],
    ['Perfect match', '完美匹配'],
    ['Good match', '良好匹配'],
    ['Missed move', '动作未匹配'],
    ['No hit markers found in the analysed poses', '在已分析的姿态中没有找到打击点'],
    ['Right hand up to replay · cross arms to choose a song', '举起右手重玩 · 交叉双臂选择歌曲'],
    ['Turn any dance video into a local one or two-player rhythm game. Camera and video processing stay on this device.', '把任意舞蹈视频变成本地单人或双人节奏游戏。摄像头和视频处理始终留在这台设备上。'],
    ['hit markers ready', '个打击点已就绪'],
    ['using compatibility mode', '正在使用兼容模式'],
  ])

  for (const [english, chinese] of expected) assert.equal(ZH[english], chinese, english)
})
