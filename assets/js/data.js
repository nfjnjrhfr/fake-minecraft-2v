/* All the fake content the site runs on. */

export const CHANNELS = {
  cr: { id: 'cr', name: '苦力怕實驗室', handle: '@creeperlab', subs: 2840000, color: '#4f9e46', verified: true },
  rs: { id: 'rs', name: '紅石大師 Redstone', handle: '@redstone_master', subs: 1120000, color: '#d93636', verified: true },
  bd: { id: 'bd', name: '方塊建築家', handle: '@blockbuilder', subs: 764000, color: '#3b82c4', verified: true },
  sv: { id: 'sv', name: '生存日記 Survival', handle: '@survivaldiary', subs: 431000, color: '#c98d63', verified: false },
  nt: { id: 'nt', name: '地獄探險隊', handle: '@netherteam', subs: 189000, color: '#8f1f0b', verified: false },
  oc: { id: 'oc', name: '深海方塊', handle: '@deepblocks', subs: 92300, color: '#1b6fa8', verified: false },
  sp: { id: 'sp', name: '速通紀錄 Speedrun', handle: '@blockspeed', subs: 1580000, color: '#f2a03d', verified: true },
};

export const CATEGORIES = [
  '全部', '遊戲', '生存', '紅石', '建築', '速通', '地獄', '模組', '直播中', '教學', '搞笑', '音樂',
];

export const VIDEOS = [
  {
    id: 'a1x9k', title: '我在極限模式活了 100 天，第 97 天差點全毀',
    channel: 'cr', views: 4820000, days: 3, duration: 1_852, style: 'overworld',
    overlay: '100 天', tags: ['生存', '遊戲'], live: false,
    desc: '這是我第一次挑戰極限模式 100 天，中途遇到雷暴、女巫村莊還有一隻卡在礦車裡的苦力怕。第 97 天那段真的手抖到不行。\n\n本集重點：\n00:00 開場\n03:12 第一個家\n11:40 下礦\n24:05 第 97 天事故現場\n\n#Minecraft #生存挑戰',
  },
  {
    id: 'b7m2q', title: '全自動西瓜農場｜每小時 3200 顆，零延遲設計',
    channel: 'rs', views: 1240000, days: 8, duration: 946, style: 'redstone',
    overlay: '3200/hr', overlayColor: '#ff5d5d', tags: ['紅石', '教學'],
    desc: '這個設計不需要觀察者鏈，也不會有卡頓問題。材料清單放在留言區置頂。',
  },
  {
    id: 'c3d8p', title: '花了 400 小時蓋的空島城市，內部全部可以走進去',
    channel: 'bd', views: 2760000, days: 14, duration: 1_320, style: 'build',
    overlay: '400 HR', overlayColor: '#7ee0ff', tags: ['建築'],
    desc: '整座城市使用約 180 萬個方塊，地圖下載連結在下方。',
  },
  {
    id: 'd5f1w', title: '地獄要塞速通紀錄！4 分 12 秒（世界紀錄）',
    channel: 'sp', views: 8930000, days: 1, duration: 268, style: 'nether',
    overlay: '4:12', overlayColor: '#ffe14d', tags: ['速通', '地獄'],
    desc: '種子碼在說明欄。這局的地獄門運氣好到不真實。',
  },
  {
    id: 'e9h4r', title: '礦坑深處傳來的聲音…我不敢再往下挖了',
    channel: 'sv', views: 612000, days: 5, duration: 1_105, style: 'cave',
    overlay: '?', overlayColor: '#ff4d4d', tags: ['生存', '搞笑'],
    desc: '戴耳機看。第 14 分鐘那個聲音到現在還沒人解釋得出來。',
  },
  {
    id: 'f2j7t', title: '海底神殿改造成透明水族館，全程無作弊',
    channel: 'oc', views: 358000, days: 11, duration: 1_640, style: 'ocean',
    overlay: '水族館', overlayColor: '#7ee0ff', tags: ['建築', '生存'],
    desc: '抽乾海底神殿花了三個禮拜，海綿真的不夠用。',
  },
  {
    id: 'g8k3v', title: '【直播中】和觀眾一起蓋一座村莊',
    channel: 'bd', views: 12400, days: 0, duration: 7_200, style: 'build',
    live: true, overlay: 'LIVE', overlayColor: '#ff4d4d', tags: ['直播中', '建築'],
    desc: '聊天室輸入方塊名稱就會出現在地圖上。',
  },
  {
    id: 'h4n6y', title: '用 1 格紅石做出的最小自動門（真的只有 1 格）',
    channel: 'rs', views: 2010000, days: 21, duration: 412, style: 'redstone',
    overlay: '1 格', overlayColor: '#ff5d5d', tags: ['紅石', '教學'],
    desc: '這個設計在 1.21 依然可用。',
  },
  {
    id: 'i6p9z', title: '苦力怕爆炸 100 次的慢動作合輯',
    channel: 'cr', views: 5310000, days: 30, duration: 738, style: 'overworld',
    overlay: 'BOOM', overlayColor: '#ff8a3d', tags: ['搞笑', '遊戲'],
    desc: '全部都是真的，沒有指令。第 87 次最誇張。',
  },
  {
    id: 'j1q5a', title: '在地獄蓋一座安全屋，結果被豬布林包圍',
    channel: 'nt', views: 274000, days: 6, duration: 1_490, style: 'nether',
    overlay: '救命', overlayColor: '#ffe14d', tags: ['地獄', '生存'],
    desc: '教訓：在地獄不要挖金磚。',
  },
  {
    id: 'k7r2b', title: '從零開始的鐵人塔教學（新手也能蓋）',
    channel: 'rs', views: 892000, days: 45, duration: 1_026, style: 'redstone',
    tags: ['紅石', '教學'],
    desc: '一步一步慢慢講，材料很便宜。',
  },
  {
    id: 'l3s8c', title: '洞穴更新後的地底世界有多深？我挖到了世界底部',
    channel: 'sv', views: 1450000, days: 60, duration: 1_712, style: 'cave',
    overlay: 'Y=-64', overlayColor: '#7ee0ff', tags: ['生存', '遊戲'],
    desc: '總共挖了 6 小時，剪成 28 分鐘。',
  },
  {
    id: 'm9t4d', title: '模組整合包實測：這 12 個模組讓遊戲完全變樣',
    channel: 'cr', views: 731000, days: 9, duration: 1_980, style: 'overworld',
    tags: ['模組', '遊戲'],
    desc: '整合包連結在說明欄，全部免費。',
  },
  {
    id: 'n5u1e', title: '海底遺跡尋寶，找到了附魔書 XVIII',
    channel: 'oc', views: 143000, days: 17, duration: 884, style: 'ocean',
    tags: ['生存'],
    desc: '運氣真的很好，開了 7 個箱子就中了。',
  },
  {
    id: 'o2v7f', title: '不用鑽石通關的挑戰，全程只用石頭工具',
    channel: 'sp', views: 3120000, days: 25, duration: 1_368, style: 'overworld',
    overlay: '無鑽石', overlayColor: '#ffe14d', tags: ['速通', '生存'],
    desc: '末影龍那段打了 40 分鐘。',
  },
  {
    id: 'p8w3g', title: '中世紀城堡建築教學 EP.1｜地基與城牆',
    channel: 'bd', views: 486000, days: 38, duration: 1_554, style: 'build',
    tags: ['建築', '教學'],
    desc: '這是系列的第一集，之後會出到內裝。',
  },
  {
    id: 'q4x9h', title: '把整個地獄改造成高速公路網（花了 200 小時）',
    channel: 'nt', views: 967000, days: 52, duration: 2_240, style: 'nether',
    overlay: '200 HR', overlayColor: '#ff8a3d', tags: ['地獄', '建築'],
    desc: '八格一格的比例真的很好用。',
  },
  {
    id: 'r6y5i', title: '凌晨三點的礦坑直播重播｜完整版',
    channel: 'sv', views: 89400, days: 4, duration: 5_412, style: 'cave',
    tags: ['生存', '直播中'],
    desc: '完整重播，沒有剪輯。',
  },
  {
    id: 's1z6j', title: '這個紅石音樂盒可以完整播放一首歌',
    channel: 'rs', views: 1780000, days: 70, duration: 322, style: 'redstone',
    overlay: '♪', overlayColor: '#7ee0ff', tags: ['紅石', '音樂'],
    desc: '總共用了 340 個音符盒。',
  },
  {
    id: 't7a2k', title: '末影龍第一次挑戰就成功？新手的運氣有點誇張',
    channel: 'cr', views: 2240000, days: 12, duration: 1_142, style: 'overworld',
    tags: ['生存', '遊戲'],
    desc: '朋友第一次玩就打贏了，我玩三年才第一次過。',
  },
  {
    id: 'u3b8l', title: '在生存模式蓋一台會動的電梯',
    channel: 'bd', views: 542000, days: 28, duration: 968, style: 'build',
    tags: ['建築', '紅石'],
    desc: '黏性活塞 + 觀察者，材料很好取得。',
  },
  {
    id: 'v9c4m', title: '海底也能種田？全自動海帶農場設計',
    channel: 'oc', views: 226000, days: 33, duration: 754, style: 'ocean',
    tags: ['紅石', '建築'],
    desc: '海帶其實是很不錯的燃料來源。',
  },
  {
    id: 'w5d1n', title: '地獄門連結出錯，我掉到了不存在的座標',
    channel: 'nt', views: 1330000, days: 19, duration: 626, style: 'nether',
    overlay: 'BUG', overlayColor: '#ff4d4d', tags: ['地獄', '搞笑'],
    desc: '存檔還在，有人知道這是什麼情況嗎。',
  },
  {
    id: 'x2e7o', title: '五分鐘學會所有附魔（完整表格）',
    channel: 'sp', views: 4110000, days: 90, duration: 314, style: 'cave',
    overlay: '5 分鐘', overlayColor: '#ffe14d', tags: ['教學', '遊戲'],
    desc: '表格圖在說明欄，可以直接存起來。',
  },
];

const COMMENT_POOL = [
  ['方塊阿明', '第 14 分鐘那個聲音我聽了三次，還是覺得有東西在後面', 1240, 18],
  ['紅石小廢物', '照著做成功了，感謝大大！雖然我炸了兩次家', 862, 12],
  ['Steve_2011', '這個剪輯品質根本電影等級', 431, 6],
  ['苦力怕本人', '我只是想抱抱而已', 9820, 3],
  ['挖礦挖到懷疑人生', '演算法把我推來這裡，結果一口氣看完整個系列', 226, 30],
  ['末影人不想被看', '請問你的材質包是哪一個？', 118, 9],
  ['村民 Hmmm', 'Hmmm.', 2410, 2],
  ['建築系學生', '這個比例抓得超好，我拿去當作業參考了（不是）', 356, 21],
  ['半夜不睡覺', '00:00 開頭那段音樂叫什麼', 74, 44],
  ['鑽石礦脈', '看完立刻去開新存檔，謝謝你毀了我的週末', 1503, 7],
  ['小白第一天', '新手問一下，這個要什麼版本才能做？', 52, 15],
  ['老玩家 2014', '從 beta 玩到現在，這遊戲還是能給我驚喜', 688, 26],
];

export function commentsFor(videoId, count = 8) {
  let h = 0;
  for (let i = 0; i < videoId.length; i++) h = (h * 31 + videoId.charCodeAt(i)) >>> 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    const [author, text, likes, hours] = COMMENT_POOL[(h + i * 7) % COMMENT_POOL.length];
    out.push({
      author,
      text,
      likes: Math.round(likes * (0.4 + (((h >> i) & 7) / 7))),
      hours: hours + i * 3,
      replies: ((h >> (i + 2)) & 3) === 0 ? 1 + ((h >> i) & 7) : 0,
      color: `hsl(${(h + i * 47) % 360} 55% 45%)`,
    });
  }
  return out;
}

/* Derived fields the UI wants everywhere. */
export const VIDEO_MAP = Object.fromEntries(
  VIDEOS.map((v) => {
    const seeded = { ...v, seed: v.id, channelObj: CHANNELS[v.channel] };
    seeded.likes = Math.round(v.views * 0.041);
    return [v.id, seeded];
  }),
);

export const ALL = Object.values(VIDEO_MAP);
