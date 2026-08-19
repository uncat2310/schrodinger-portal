/**
 * 按时段返回问候语（前后端共用）
 */
export function getGreeting(hours) {
  if (hours >= 5 && hours < 9) return { greeting: '清晨好，新的一天', icon: '🌅' };
  if (hours >= 9 && hours < 12) return { greeting: '上午好，专注当下', icon: '☀️' };
  if (hours >= 12 && hours < 14) return { greeting: '午间好，享受静谧时光', icon: '☕' };
  if (hours >= 14 && hours < 18) return { greeting: '下午好，保持高效', icon: '💻' };
  if (hours >= 18 && hours < 23) return { greeting: '晚上好，一切安然有序', icon: '🌙' };
  return { greeting: '夜深了，系统持续守护', icon: '🌌' };
}
