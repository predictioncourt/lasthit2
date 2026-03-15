const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const asValueEl = document.getElementById('as-value');
const gameOverScreen = document.getElementById('game-over-screen');
const failReasonEl = document.getElementById('fail-reason');

// Ayarlar Elementleri
const settingsModal = document.getElementById('settings-modal');
const keyBindBtn = document.getElementById('key-bind-btn');
const stopKeyBindBtn = document.getElementById('stop-key-bind-btn');
const keyBindMsg = document.getElementById('key-bind-msg');
const currentKeyDisplay = document.getElementById('current-key-display');
const currentStopKeyDisplay = document.getElementById('current-stop-key-display');

// Canvas Boyutlandırma
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Oyun Değişkenleri
let gameRunning = true;
let score = 0;
// lastSpawnTime ve spawnInterval artık tek düşman mantığında gereksiz ama
// respawn gecikmesi için kullanabiliriz.
let lastSpawnTime = 0; 
let gameMode = 'lasthit'; // Sadece 'lasthit' kaldı

function changeGameMode(mode) {
    gameMode = mode;
    restartGame();
}

// Tuş Ayarları
let attackKey = 'KeyA'; // Varsayılan A tuşu
let attackKeyDisplay = 'A';
let stopKey = 'KeyS';
let stopKeyDisplay = 'S';
let isBindingKey = false;
let bindingTarget = null;
let isAttackMode = false; // A'ya basıldı mı?
let attackMove = {
    active: false,
    target: null,
    moveX: 0,
    moveY: 0
};

const SPEEDS = {
    player: 220,
    minion: 132
};

let lastFrameTime = performance.now();

// Mermiler Dizisi
let projectiles = [];

class Projectile {
    constructor(startX, startY, target, damage, color, speed = 420) {
        this.x = startX;
        this.y = startY;
        this.target = target;
        this.damage = damage;
        this.color = color;
        this.speed = speed;
        this.radius = 4;
        this.active = true;
    }

    update(deltaSeconds) {
        if (!this.target || this.target.health <= 0) {
            this.active = false;
            return;
        }

        const dist = getDistance(this.x, this.y, this.target.x, this.target.y);
        if (dist < 10) {
            this.target.health -= this.damage;
            this.active = false;
            return;
        }

        const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        const step = this.speed * deltaSeconds;
        this.x += Math.cos(angle) * step;
        this.y += Math.sin(angle) * step;
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.closePath();
    }
}

// Oyuncu Ayarları
const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 15,
    color: '#3498db',
    speed: SPEEDS.player,
    targetX: canvas.width / 2,
    targetY: canvas.height / 2,
    range: 200, // Saldırı Menzili
    damage: 60, // Son vuruş için düşük hasar
    attackSpeed: 0.90, // Saniyedeki saldırı sayısı
    lastAttackTime: 0 // Son saldırı zamanı
};

// Düşmanlar Dizisi
let minions = [];
let lastMinionAttackTime = 0;

// Yardımcı Fonksiyonlar
function getDistance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function applyPlayerAttack(targetMinion, now) {
    targetMinion.health -= player.damage;
    player.lastAttackTime = now;
    if (targetMinion.health <= 0) {
        targetMinion.killedByPlayer = true;
        score += 50;
        scoreEl.innerText = score;
    }
}

function findClosestEnemyInRange() {
    let closest = null;
    let closestDist = Infinity;
    for (let minion of minions) {
        if (minion.team === 'red') {
            const distToPlayer = getDistance(player.x, player.y, minion.x, minion.y);
            if (distToPlayer <= player.range + minion.radius && distToPlayer < closestDist) {
                closest = minion;
                closestDist = distToPlayer;
            }
        }
    }
    return closest;
}

function handleAttackMove() {
    if (!attackMove.active) return;

    const now = performance.now();
    const attackCooldown = 1000 / player.attackSpeed;
    const canAttack = now - player.lastAttackTime >= attackCooldown;

    if (attackMove.target && attackMove.target.health <= 0) {
        attackMove.target = null;
    }

    if (attackMove.target) {
        const distToPlayer = getDistance(player.x, player.y, attackMove.target.x, attackMove.target.y);
        if (distToPlayer <= player.range + attackMove.target.radius) {
            if (canAttack) {
                applyPlayerAttack(attackMove.target, now);
                attackMove.active = false;
                attackMove.target = null;
                player.targetX = player.x;
                player.targetY = player.y;
            } else {
                player.targetX = player.x;
                player.targetY = player.y;
            }
        } else {
            player.targetX = attackMove.target.x;
            player.targetY = attackMove.target.y;
        }
        return;
    }

    const inRangeTarget = findClosestEnemyInRange();
    if (inRangeTarget) {
        if (canAttack) {
            applyPlayerAttack(inRangeTarget, now);
            attackMove.active = false;
            player.targetX = player.x;
            player.targetY = player.y;
        } else {
            player.targetX = player.x;
            player.targetY = player.y;
        }
        return;
    }

    player.targetX = attackMove.moveX;
    player.targetY = attackMove.moveY;
}

// Oyun Başlatma/Sıfırlama
function restartGame() {
    gameRunning = true;
    score = 0;
    scoreEl.innerText = score;
    if (asValueEl) asValueEl.innerText = player.attackSpeed.toFixed(2);
    minions = [];
    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
    player.targetX = player.x;
    player.targetY = player.y;
    player.speed = SPEEDS.player;
    
    spawnWave();

    lastSpawnTime = performance.now();
    lastFrameTime = performance.now();

    isAttackMode = false;
    attackMove.active = false;
    attackMove.target = null;
    document.body.classList.remove('attack-mode');
    gameOverScreen.classList.add('hidden');
    requestAnimationFrame(gameLoop);
}

function gameOver(reason) {
    gameRunning = false;
    failReasonEl.innerText = reason;
    gameOverScreen.classList.remove('hidden');
}

// Ayarlar Menüsü Fonksiyonları
function toggleSettings() {
    settingsModal.classList.toggle('hidden');
    // Oyun durdurulabilir istenirse, şimdilik devam etsin
}

function startKeyBind(target) {
    isBindingKey = true;
    bindingTarget = target;
    const activeBtn = target === 'stop' ? stopKeyBindBtn : keyBindBtn;
    activeBtn.classList.add('binding');
    activeBtn.innerText = '...';
    keyBindMsg.classList.remove('hidden');
}

function updateKeyBinding(code, key) {
    if (bindingTarget === 'stop') {
        stopKey = code;
        stopKeyDisplay = key.toUpperCase();
        stopKeyBindBtn.innerText = stopKeyDisplay;
        currentStopKeyDisplay.innerText = stopKeyDisplay;
    } else {
        attackKey = code;
        attackKeyDisplay = key.toUpperCase();
        keyBindBtn.innerText = attackKeyDisplay;
        currentKeyDisplay.innerText = attackKeyDisplay;
    }
    
    // Reset
    isBindingKey = false;
    bindingTarget = null;
    keyBindBtn.classList.remove('binding');
    stopKeyBindBtn.classList.remove('binding');
    keyBindMsg.classList.add('hidden');
}

// Minyon Sınıfı (Last Hit Modu için)
class Minion {
    constructor(team, type, x, y) {
        this.team = team; // 'blue' veya 'red'
        this.type = type; // 'melee' veya 'ranged'
        this.radius = type === 'melee' ? 18 : 15;
        this.x = x;
        this.y = y;
        
        // Özellikler (LoL Dengesi)
        if (type === 'melee') {
            this.maxHealth = 450;
            this.health = this.maxHealth;
            this.damage = 12;
            this.range = 40;
            this.attackCooldown = 1200; // ms
            this.color = team === 'blue' ? '#3498db' : '#e74c3c';
        } else {
            this.maxHealth = 280;
            this.health = this.maxHealth;
            this.damage = 24;
            this.range = 250;
            this.attackCooldown = 1500; // ms
            this.color = team === 'blue' ? '#5dade2' : '#ec7063';
        }
        
        this.lastAttackTime = 0;
        this.target = null;
        this.speed = SPEEDS.minion;
        this.isAttacking = false; // Animasyon durumu
        this.attackAnimProgress = 0;
        this.killedByPlayer = false; // Son vuruş kontrolü
    }

    findTarget() {
        let nearestDist = Infinity;
        let potentialTarget = null;

        const targets = minions.filter(m => m.team !== this.team);
        
        targets.forEach(t => {
            const dist = getDistance(this.x, this.y, t.x, t.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                potentialTarget = t;
            }
        });

        this.target = potentialTarget;
    }

    update(deltaSeconds) {
        if (!this.target || this.target.health <= 0) {
            this.findTarget();
        }

        if (this.target) {
            const dist = getDistance(this.x, this.y, this.target.x, this.target.y);
            const attackDist = this.range + this.radius + this.target.radius;

            if (dist > attackDist && !this.isAttacking) {
                // Hedefe yürü
                const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
                const step = this.speed * deltaSeconds;
                this.x += Math.cos(angle) * step;
                this.y += Math.sin(angle) * step;
            } else {
                // Saldır
                const now = performance.now();
                if (now - this.lastAttackTime > this.attackCooldown) {
                    if (this.type === 'ranged') {
                        // Menzilli: Mermi fırlat
                        projectiles.push(new Projectile(this.x, this.y, this.target, this.damage, this.color));
                    } else {
                        // Yakıncı: Direkt hasar
                        this.target.health -= this.damage;
                    }
                    this.lastAttackTime = now;
                    this.isAttacking = true;
                    this.attackAnimProgress = 10;
                }
            }
        }

        if (this.attackAnimProgress > 0) {
            this.attackAnimProgress--;
        } else {
            this.isAttacking = false;
        }
    }

    draw() {
        // Gövde
        ctx.save();
        if (this.isAttacking && this.type === 'melee') {
            // Basit bir sarsıntı/saldırı animasyonu
            const offset = this.attackAnimProgress;
            ctx.translate(offset, 0);
        }
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = this.type === 'ranged' ? 1 : 3;
        ctx.stroke();
        ctx.closePath();
        ctx.restore();

        // Can Barı
        const barWidth = 30;
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(this.x - barWidth/2, this.y - 25, barWidth, 4);
        ctx.fillStyle = this.team === 'blue' ? '#2ecc71' : '#e74c3c';
        ctx.fillRect(this.x - barWidth/2, this.y - 25, barWidth * healthPercent, 4);
    }
}

function spawnWave() {
    minions = [];
    projectiles = []; // Mermileri temizle
    const centerY = canvas.height / 2;
    const spawnDist = 250; // Birbirlerine daha yakın doğsunlar
    
    // Mavi Takım (Sol)
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('blue', 'melee', canvas.width / 2 - spawnDist, centerY - 100 + i * 100));
    }
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('blue', 'ranged', canvas.width / 2 - spawnDist - 60, centerY - 100 + i * 100));
    }

    // Kırmızı Takım (Sağ)
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('red', 'melee', canvas.width / 2 + spawnDist, centerY - 100 + i * 100));
    }
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('red', 'ranged', canvas.width / 2 + spawnDist + 60, centerY - 100 + i * 100));
    }
}

function spawnEnemy(timestamp) {
    const redMinions = minions.filter(m => m.team === 'red');
    if (redMinions.length === 0) {
        spawnWave();
    }
}

function updatePlayer(deltaSeconds) {
    const dist = getDistance(player.x, player.y, player.targetX, player.targetY);
    const step = player.speed * deltaSeconds;
    
    // Titremeyi önlemek için: Eğer mesafe hızdan küçükse direkt hedefe ışınlan
    if (dist > 0) {
        if (dist < step) {
            player.x = player.targetX;
            player.y = player.targetY;
        } else {
            const angle = Math.atan2(player.targetY - player.y, player.targetX - player.x);
            player.x += Math.cos(angle) * step;
            player.y += Math.sin(angle) * step;
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Saldırı Menzili (Sadece Attack Mode aktifse göster)
    if (isAttackMode) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.closePath();
    }

    // Oyuncu
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    
    // Hareket Hedefi
    if (getDistance(player.x, player.y, player.targetX, player.targetY) > 5) {
        ctx.beginPath();
        ctx.arc(player.targetX, player.targetY, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 255, 0, 0.5)";
        ctx.fill();
    }

    minions.forEach(minion => minion.draw());
    projectiles.forEach(p => p.draw());
}

function gameLoop(timestamp) {
    if (!gameRunning) return;

    const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
    lastFrameTime = timestamp;

    spawnEnemy(timestamp);
    
    handleAttackMove();
    updatePlayer(deltaSeconds);
    
    minions.forEach(minion => minion.update(deltaSeconds));
    
    // Mermileri güncelle
    projectiles.forEach(p => p.update(deltaSeconds));
    projectiles = projectiles.filter(p => p.active);

    // Ölü minyonları kontrol et ve temizle
    for (let minion of minions) {
        if (minion.health <= 0) {
            if (minion.team === 'red' && !minion.killedByPlayer) {
                gameOver("Bir minyon kaçırdın! Son vuruşu yapmalıydın.");
                return;
            }
        }
    }
    
    minions = minions.filter(m => m.health > 0);
    
    draw();

    requestAnimationFrame(gameLoop);
}

// --- KONTROLLER ---

// Klavye Kontrolleri (Saldırı Modu ve Tuş Atama)
window.addEventListener('keydown', (e) => {
    // Eğer tuş atama modundaysak
    if (isBindingKey) {
        updateKeyBinding(e.code, e.key);
        return;
    }

    // Saldırı Tuşuna Basıldı mı? (Örn: A)
    if (e.code === attackKey && gameRunning) {
        isAttackMode = true;
        document.body.classList.add('attack-mode'); // CSS ile cursor değişecek
    }

    if (e.code === stopKey && gameRunning) {
        isAttackMode = false;
        attackMove.active = false;
        attackMove.target = null;
        player.targetX = player.x;
        player.targetY = player.y;
        document.body.classList.remove('attack-mode');
    }
});

// Sağ Tık: Hareket veya Minyona Saldırı (mousedown ile daha seri tepki)
window.addEventListener('mousedown', (e) => {
    if (!gameRunning) return;

    // Sağ Tık (Button 2)
    if (e.button === 2) {
        // Sağ tık her zaman saldırı modunu iptal eder
        isAttackMode = false;
        attackMove.active = false;
        attackMove.target = null;
        document.body.classList.remove('attack-mode');

        const clickX = e.clientX;
        const clickY = e.clientY;

        // Önce tıklanan yerde bir kırmızı minyon var mı kontrol et
        let targetMinion = null;
        for (let minion of minions) {
            if (minion.team === 'red') {
                const distToClick = getDistance(clickX, clickY, minion.x, minion.y);
                if (distToClick <= minion.radius + 10) {
                    targetMinion = minion;
                    break;
                }
            }
        }

        if (targetMinion) {
            const now = performance.now();
            const attackCooldown = 1000 / player.attackSpeed;
            const canAttack = now - player.lastAttackTime >= attackCooldown;

            const distToPlayer = getDistance(player.x, player.y, targetMinion.x, targetMinion.y);

            if (distToPlayer <= player.range + targetMinion.radius) {
                if (canAttack) {
                    applyPlayerAttack(targetMinion, now);

                    // Saldırı sonrası olduğu yerde kal
                    player.targetX = player.x;
                    player.targetY = player.y;
                } else {
                    // Saldırı hazır değilse minyona doğru yürüsün
                    player.targetX = clickX;
                    player.targetY = clickY;
                }
            } else {
                // Menzil dışındaysa tıklanan yere yürüsün (minyona yaklaşma)
                player.targetX = clickX;
                player.targetY = clickY;
            }
        } else {
            // Minyon yoksa normal hareket
            player.targetX = clickX;
            player.targetY = clickY;
        }
    }
});

// Context Menu'yu engelle (Sadece görsel engelleme)
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Sol Tık: Saldırı
window.addEventListener('click', (e) => {
    if (!gameRunning) return;
    
    // UI elementlerine tıklamayı engelle (Basit kontrol)
    if (e.target.closest('#settings-modal') || e.target.closest('#settings-btn')) return;

    // SADECE Attack Mode açıksa saldırı yapılabilir
    if (isAttackMode) {
        const clickX = e.clientX;
        const clickY = e.clientY;
        
        // --- MİNYON HEDEFLEME ---
        let targetMinion = null;
        let closestDistToPlayer = Infinity;

        // 1. Önce tıklanan yerde minyon var mı bak (Targeted Attack)
        for (let minion of minions) {
            if (minion.team === 'red') {
                const distToClick = getDistance(clickX, clickY, minion.x, minion.y);
                if (distToClick <= minion.radius + 10) { // Biraz tolerans payı
                    targetMinion = minion;
                    break;
                }
            }
        }

        // 2. Eğer tıklanan yerde minyon yoksa, en yakın olanı seç (Attack Move)
        if (!targetMinion) {
            for (let minion of minions) {
                if (minion.team === 'red') {
                    const distToPlayer = getDistance(player.x, player.y, minion.x, minion.y);
                    if (distToPlayer <= player.range + minion.radius) {
                        if (distToPlayer < closestDistToPlayer) {
                            closestDistToPlayer = distToPlayer;
                            targetMinion = minion;
                        }
                    }
                }
            }
        }

        attackMove.active = true;
        attackMove.target = targetMinion;
        attackMove.moveX = clickX;
        attackMove.moveY = clickY;

        isAttackMode = false;
        document.body.classList.remove('attack-mode');
    }
});

requestAnimationFrame(gameLoop);
