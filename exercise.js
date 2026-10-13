const api = window.exerciseAPI;

let EXERCISES = [];
let currentExercise = null;

const menuList = document.getElementById('ex-menu-list');
const panelMenu = document.getElementById('ex-panel-menu');
const panelDetail = document.getElementById('ex-panel-detail');
const panelSteps = document.getElementById('ex-panel-steps');

function renderMenu() {
  menuList.innerHTML = '';
  EXERCISES.forEach((ex) => {
    const item = document.createElement('div');
    item.className = 'ex-menu-item';
    item.innerHTML = '<span>' + ex.name + '</span><span class="ex-menu-time">' + ex.duration + '</span>';
    item.onclick = () => {
      currentExercise = ex;
      document.getElementById('ex-detail-name').textContent = ex.name;
      document.getElementById('ex-detail-duration').textContent = '时长：' + ex.duration;
      document.getElementById('ex-detail-benefits').textContent = ex.benefits;
      panelMenu.style.display = 'none';
      panelDetail.style.display = 'block';
      panelSteps.style.display = 'none';
    };
    menuList.appendChild(item);
  });
}

function resetToMenu() {
  panelMenu.style.display = 'block';
  panelDetail.style.display = 'none';
  panelSteps.style.display = 'none';
}

document.getElementById('ex-close').onclick = () => {
  api.notifyMaid('好哒~ 主人别忘了多喝点水哦！');
  api.close();
};
document.getElementById('ex-cancel').onclick = () => {
  api.notifyMaid('好哒~ 主人别忘了多喝点水哦！');
  api.close();
};
document.getElementById('ex-back').onclick = resetToMenu;
document.getElementById('ex-try').onclick = () => {
  if (!currentExercise) return;
  document.getElementById('ex-steps-name').textContent = currentExercise.name;
  const ol = '<ol>' + currentExercise.steps.map(s => '<li>' + s + '</li>').join('') + '</ol>';
  document.getElementById('ex-steps-content').innerHTML = ol;
  document.getElementById('ex-steps-tip').textContent = currentExercise.tip;
  panelMenu.style.display = 'none';
  panelDetail.style.display = 'none';
  panelSteps.style.display = 'block';
};
document.getElementById('ex-done').onclick = () => {
  const CHEERS = [
    '加油呀主人~ 我在这里陪着你！',
    '主人最棒啦~ 慢慢来，不着急哦！',
    '嗯嗯~ 主人注意安全，慢慢舒展就好！',
    '主人加油！做完记得表扬一下自己哦~',
  ];
  api.notifyMaid(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  api.close();
};

(async () => {
  EXERCISES = await api.getList();
  renderMenu();
  resetToMenu();
})();
