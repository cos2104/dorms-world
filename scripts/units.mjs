// pack.json 의 units 에 적을 이름을 도름스 오락실에서 찾아 보여 준다.
//   npm run units                 학년(band)과 과목 목록
//   npm run units -- ms1 수학      그 학년 그 과목의 단원 이름
const ORIGIN = process.env.DORMS_ORIGIN && process.env.DORMS_ALLOW_CUSTOM_ORIGIN === '1' ? process.env.DORMS_ORIGIN.replace(/\/+$/, '') : 'https://dorms.school';
const [band, subject] = process.argv.slice(2);
const q = band && subject ? `?band=${encodeURIComponent(band)}&subject=${encodeURIComponent(subject)}` : '';
let data;
try {
  const res = await fetch(`${ORIGIN}/api/world/units${q}`, { signal: AbortSignal.timeout(20_000) });
  data = await res.json();
  if (!res.ok) throw new Error(String(data?.message ?? res.status));
} catch (err) { console.error(`도름스에서 단원 목록을 읽지 못했어요(${err.message}).`); process.exit(1); }
if (Array.isArray(data.units)) {
  if (!data.units.length) console.log(`${band} ${subject} 에는 단원이 없어요. npm run units 로 학년과 과목 이름을 확인해 주세요.`);
  else console.log(`${band} ${subject} 의 단원(이름을 그대로 적어요):\n  ${data.units.map(String).join('\n  ')}`);
} else for (const b of data.bands ?? []) console.log(`${String(b.code).padEnd(8)} ${b.label}: ${(b.subjects ?? []).join(', ')}`);
