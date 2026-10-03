// 공공데이터포털 "공공기관 채용정보 조회서비스" → 진행 중 공고 전체를 feed.json으로 저장
// 개인 필터 없음: 앱에서 사용자가 고용형태·신입/경력·지역으로 직접 고른다.
// 실행: ALIO_KEY=인증키 node scripts/feed.js   (GitHub Actions에서 매일 실행)
const fs = require("fs");
const path = require("path");

const API = "https://apis.data.go.kr/1051000/recruitment/list";

function ymd(s){
  const d = String(s || "").replace(/[^0-9]/g, "");
  return d.length >= 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : "";
}
const list = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean);

function slim(it){
  return {
    sn: it.recrutPblntSn,
    org: it.instNm || "",
    title: String(it.recrutPbancTtl || "").trim(),
    hire: list(it.hireTypeNmLst),
    se: it.recrutSeNm || "",
    nope: it.recrutNope || 0,
    rgn: list(it.workRgnNmLst),
    ncs: it.ncsCdNmLst || "",
    replace: it.replmprYn === "Y",
    start: ymd(it.pbancBgngYmd),
    end: ymd(it.pbancEndYmd),
    url: it.srcUrl || ""
  };
}

// 공공데이터포털 API가 잠깐 끊기는 일이 잦아서, 실패하면 간격을 늘려 가며 다시 시도한다
async function getJSON(url, tries = 4){
  let last;
  for (let i = 0; i < tries; i++){
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 15000 * (i + 1)));
    }
  }
  throw last;
}

async function fetchAll(key){
  const items = [];
  for (let page = 1; page <= 20; page++){
    const q = new URLSearchParams({ serviceKey: key, resultType: "json", ongoingYn: "Y", numOfRows: "100", pageNo: String(page) });
    const j = await getJSON(`${API}?${q}`);
    if (j.resultCode !== 200 && j.resultCode !== 0) throw new Error(`API ${j.resultCode} ${j.resultMsg}`);
    const rows = (j.result || []).map(r => r.item || r);
    items.push(...rows);
    if (!rows.length || items.length >= (j.totalCount || 0)) break;
  }
  return items;
}

async function main(){
  const key = process.env.ALIO_KEY;
  if (!key) throw new Error("ALIO_KEY 환경변수가 없습니다");
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString();
  const today = kst.slice(0, 10);
  const items = (await fetchAll(key)).map(slim).filter(x => x.end && x.end >= today);
  items.sort((a, b) => a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
  const out = { updated: kst.slice(0, 16).replace("T", " "), source: "공공데이터포털 공공기관 채용정보 조회서비스", items };
  fs.writeFileSync(path.join(__dirname, "..", "feed.json"), JSON.stringify(out) + "\n");
  console.log(`진행 중 공고 ${items.length}건 저장`);
}

// 알리오 쪽 장애로 못 받아오면 기존 feed.json을 그대로 두고 경고만 남긴다 (실패 메일·빈 목록 방지)
main().catch(e => {
  console.log(`::warning::공고를 받아오지 못해 기존 목록을 유지합니다: ${e.message}`);
  if (e.message.includes("ALIO_KEY")) process.exit(1);
});
