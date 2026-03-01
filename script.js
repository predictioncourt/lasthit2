const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const asValueEl = document.getElementById('as-value');
const gameOverScreen = document.getElementById('game-over-screen');
const failReasonEl = document.getElementById('fail-reason');
const missedCsEl = document.getElementById('missed-cs');

// Ayarlar Elementleri
const settingsModal = document.getElementById('settings-modal');
const keyBindBtn = document.getElementById('key-bind-btn');
const keyBindMsg = document.getElementById('key-bind-msg');
const currentKeyDisplay = document.getElementById('current-key-display');

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
let missedCS = 0;
const MAX_MISSED_CS = 3; // 2 hak (3.de biter)
let lastSpawnTime = 0; 
let spawnInterval = 25000; // 25 saniyede bir yeni dalga (Daha yavaş)

// Tuş Ayarları
let attackKey = 'KeyA'; 
let attackKeyDisplay = 'A';
let isBindingKey = false;
let isAttackMode = false;

const SPEEDS = {
    player: 250,
    minion: 2.2,
    ezrealQ: 12,
    ezrealW: 10,
    caitlynQ: 10
};

let lastFrameTime = performance.now();
let deltaSeconds = 0; // Global delta time
let accumulatorSeconds = 0;
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 6;
let projectiles = [];
let particles = [];
let minions = [];
let pendingAttackTarget = null;

// Yardımcı Fonksiyonlar
function getDistance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function resolveMinionCollisions() {
    const iterations = 2;
    for (let k = 0; k < iterations; k++) {
        for (let i = 0; i < minions.length; i++) {
            const a = minions[i];
            if (!a || a.health <= 0) continue;
            for (let j = i + 1; j < minions.length; j++) {
                const b = minions[j];
                if (!b || b.health <= 0) continue;
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.hypot(dx, dy);
                const minDist = a.radius + b.radius + 2;
                if (dist === 0) {
                    dx = 1;
                    dy = 0;
                    dist = 1;
                }
                if (dist < minDist) {
                    const overlap = (minDist - dist) / 2;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    a.x -= nx * overlap;
                    a.y -= ny * overlap;
                    b.x += nx * overlap;
                    b.y += ny * overlap;

                    a.x = Math.max(a.radius, Math.min(canvas.width - a.radius, a.x));
                    a.y = Math.max(a.radius, Math.min(canvas.height - a.radius, a.y));
                    b.x = Math.max(b.radius, Math.min(canvas.width - b.radius, b.x));
                    b.y = Math.max(b.radius, Math.min(canvas.height - b.radius, b.y));
                }
            }
        }
    }
}

function spawnBurst(x, y, color, count, minSpeed, maxSpeed, minLife, maxLife, minSize, maxSize, shrink = 0.02) {
    for (let i = 0; i < count; i++) {
        const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
        const angle = Math.random() * Math.PI * 2;
        const life = minLife + Math.random() * (maxLife - minLife);
        const size = minSize + Math.random() * (maxSize - minSize);
        particles.push(new Particle(x, y, color, speed, angle, life, size, shrink));
    }
}

function setAttackOrder(target) {
    pendingAttackTarget = target;
}

function clearAttackOrder() {
    pendingAttackTarget = null;
}

function spawnLineBurst(x1, y1, x2, y2, color, count, minSize, maxSize) {
    const baseAngle = Math.atan2(y2 - y1, x2 - x1);
    for (let i = 0; i < count; i++) {
        const t = Math.random();
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const angle = baseAngle + (Math.random() - 0.5) * 0.8;
        const speed = 0.8 + Math.random() * 2.2;
        const life = 0.5 + Math.random() * 0.7;
        const size = minSize + Math.random() * (maxSize - minSize);
        particles.push(new Particle(x, y, color, speed, angle, life, size, 0.03));
    }
}

class Particle {
    constructor(x, y, color, speed, angle, life, size = 2, shrink = 0.02) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.speed = speed;
        this.angle = angle;
        this.life = life;
        this.size = size;
        this.shrink = shrink;
        this.active = true;
    }
    update(delta) {
        const moveStep = this.speed * (delta * 60);
        this.x += Math.cos(this.angle) * moveStep;
        this.y += Math.sin(this.angle) * moveStep;
        this.life -= 0.02 * (delta * 60);
        this.size = Math.max(0, this.size - (this.shrink * (delta * 60)));
        if (this.life <= 0 || this.size <= 0) this.active = false;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }
}

class Projectile {
    constructor(startX, startY, target, damage, color, speed = 7, type = 'basic', owner = null) {
        this.x = startX;
        this.y = startY;
        this.target = target; // target can be object {x, y} or minion/champion
        this.damage = damage;
        this.color = color;
        this.speed = speed;
        this.radius = type === 'ezrealQ' ? 6 : (type === 'ezrealW' ? 12 : (type === 'caitlynQ' ? 14 : (type === 'ezrealE' ? 8 : 4)));
        this.active = true;
        this.type = type;
        this.owner = owner;
        this.isSkillshot = ['ezrealQ', 'ezrealW', 'caitlynQ', 'ezrealE'].includes(type);
        this.pierce = type === 'caitlynQ' || type === 'ezrealW'; // W minyonlardan geçmeli (pierce=true), ama şampiyonda durmalı
        this.hitTargets = new Set();
        this.angle = 0;
        this.vx = 0;
        this.vy = 0;
        this.length = type === 'caitlynQ' ? 90 : (type === 'ezrealQ' ? 34 : (type === 'ezrealE' ? 24 : 26));
        this.width = type === 'caitlynQ' ? 22 : (type === 'ezrealQ' ? 10 : (type === 'ezrealE' ? 10 : 20));

        if (this.isSkillshot) {
            const angle = Math.atan2(target.y - startY, target.x - startX);
            this.angle = angle;
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed;
        }
    }

    update(delta) { // delta parameter added
        if (this.type === 'basic') {
            if (!this.target || this.target.health <= 0) {
                this.active = false;
                return;
            }
            const dist = getDistance(this.x, this.y, this.target.x, this.target.y);
            if (dist < 15) {
                this.hit(this.target);
                this.active = false;
                return;
            }
            const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
            // Delta time ile hareket
            const moveStep = this.speed * (delta * 60); // 60 FPS baz alınarak ayarlandı
            this.x += Math.cos(angle) * moveStep;
            this.y += Math.sin(angle) * moveStep;
        } else {
            // Skillshot
            // Delta time ile hareket
            const moveStepX = this.vx * (delta * 60);
            const moveStepY = this.vy * (delta * 60);
            this.x += moveStepX;
            this.y += moveStepY;

            // Check collision with units
            const targets = (this.owner instanceof Ezreal) ? 
                [...minions.filter(m => m.team === 'red'), enemy] : 
                [...minions.filter(m => m.team === 'blue'), player];

            for (let t of targets) {
                if (!t || t.health <= 0) continue;
                if (this.hitTargets.has(t)) continue;
                if (this.type === 'ezrealW' && t instanceof Minion) continue;
                if (getDistance(this.x, this.y, t.x, t.y) < t.radius + this.radius) {
                    this.hit(t);
                    this.hitTargets.add(t);
                    if (this.type === 'ezrealW' && t instanceof Champion) {
                        this.active = false;
                        return;
                    }
                    if (!this.pierce) {
                        this.active = false;
                        return;
                    }
                }
            }

            // Screen bounds
            if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
                this.active = false;
            }

            if (this.type === 'ezrealQ' && Math.random() < 0.35) {
                particles.push(new Particle(this.x, this.y, '#dfe6e9', 0.6 + Math.random() * 1.2, this.angle + Math.PI, 0.5, 1.6, 0.04));
            }
            if (this.type === 'caitlynQ' && Math.random() < 0.25) {
                particles.push(new Particle(this.x, this.y, '#ff7675', 0.4 + Math.random() * 1.0, this.angle + Math.PI, 0.5, 1.2, 0.04));
            }
            if (this.type === 'ezrealW' && Math.random() < 0.2) {
                particles.push(new Particle(this.x, this.y, '#f1c40f', 0.3 + Math.random(), this.angle + Math.PI, 0.6, 1.5, 0.03));
            }
        }
    }

    hit(unit) {
        let finalDamage = this.damage;
        if (unit instanceof Champion && this.owner instanceof Ezreal) {
            if (unit.wMarked && (this.type === 'ezrealQ' || this.type === 'ezrealE' || this.type === 'basic')) {
                finalDamage += 100; // W proc damage
                unit.wMarked = false;
                spawnBurst(unit.x, unit.y, '#f1c40f', 14, 0.8, 3.2, 0.5, 1, 2, 4);
            }
        }
        
        if (this.type === 'ezrealW' && unit instanceof Champion) {
            // Sadece Şampiyonlara W yapışır (LoL Mantığı: W minyonlara çarpmaz, şampiyonlara çarpar)
            unit.wMarked = true;
            unit.wMarkTime = performance.now();
            spawnBurst(unit.x, unit.y, '#f1c40f', 10, 0.6, 2.2, 0.5, 0.9, 2, 3);
            this.active = false; // Mermiyi yok et (içinden geçmesin)
        } else if (this.type === 'ezrealW' && unit instanceof Minion) {
             // Minyonlara çarpmasın, içinden geçsin (LoL mantığı)
             // Minyonlara hiç hasar vermesin veya etkileşime girmesin
        } else if (this.type !== 'ezrealW') {
            const wasAlive = unit.health > 0;
            unit.health -= finalDamage;
            
            // Minyon Ölüm Kontrolü
            if (wasAlive && unit.health <= 0 && unit instanceof Minion) {
                if (unit.team === 'red') { // Rakip minyon öldü (Bizim almamız lazımdı)
                    if (this.owner instanceof Ezreal) {
                        score++;
                        scoreEl.innerText = score;
                    } else {
                        // Kule veya minyonlar öldürdü, biz kaçırdık
                        missedCS++;
                        if (missedCsEl) missedCsEl.innerText = MAX_MISSED_CS - missedCS;
                        if (missedCS >= MAX_MISSED_CS) {
                            failReasonEl.innerText = "Çok fazla minyon kaçırdın!";
                            gameOverScreen.classList.remove('hidden');
                            gameRunning = false;
                        } else {
                            // Uyarı efekti veya sesi eklenebilir
                            spawnBurst(unit.x, unit.y, '#e74c3c', 20, 1, 4, 0.5, 1, 2, 5); // Kırmızı patlama
                        }
                    }
                }
            }
        }

        spawnBurst(this.x, this.y, this.color, 8, 0.5, 2.2, 0.4, 0.8, 1.5, 3);
    }

    draw() {
        if (this.type === 'basic') {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = this.color;
            ctx.fill();
            ctx.restore();
            return;
        }

        if (this.type === 'ezrealW') {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(0, 0, this.width, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 20;
            ctx.shadowColor = this.color;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, this.width * 0.55, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (this.type === 'caitlynQ' || this.type === 'ezrealQ') {
            const len = this.length;
            const w = this.width;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.beginPath();
            ctx.moveTo(-len / 2, -w / 2);
            ctx.lineTo(len / 2, -w / 2);
            ctx.arc(len / 2, 0, w / 2, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(-len / 2, w / 2);
            ctx.arc(-len / 2, 0, w / 2, Math.PI / 2, -Math.PI / 2);
            ctx.closePath();
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 18;
            ctx.shadowColor = this.color;
            ctx.fill();
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(-len / 2, -w / 6);
            ctx.lineTo(len / 2, -w / 6);
            ctx.arc(len / 2, 0, w / 6, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(-len / 2, w / 6);
            ctx.arc(-len / 2, 0, w / 6, Math.PI / 2, -Math.PI / 2);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
            return;
        }

        if (this.type === 'ezrealE') {
            const s = this.width;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.beginPath();
            ctx.moveTo(s, 0);
            ctx.lineTo(0, -s);
            ctx.lineTo(-s, 0);
            ctx.lineTo(0, s);
            ctx.closePath();
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 16;
            ctx.shadowColor = this.color;
            ctx.fill();
            ctx.restore();
            return;
        }
    }
}

class Champion {
    constructor(name, x, y, color, team) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.radius = 20;
        this.color = color;
        this.team = team;
        this.maxHealth = 800;
        this.health = this.maxHealth;
        this.speed = SPEEDS.player;
        this.targetX = x;
        this.targetY = y;
        this.range = 250;
        this.damage = 70;
        this.attackSpeed = 0.9;
        this.lastAttackTime = 0;
        this.wMarked = false;
        this.wMarkTime = 0;
    }

    drawHealthBar() {
        const barWidth = 50;
        const barHeight = 6;
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(this.x - barWidth/2, this.y - 40, barWidth, barHeight);
        
        ctx.fillStyle = this.team === 'blue' ? '#2ecc71' : '#e74c3c';
        ctx.fillRect(this.x - barWidth/2, this.y - 40, barWidth * healthPercent, barHeight);
        
        if (this.wMarked) {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 8 + pulse * 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(241,196,15,0.7)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        this.drawHealthBar();
    }

    update(deltaSeconds) {
        const dist = getDistance(this.x, this.y, this.targetX, this.targetY);
        const step = this.speed * deltaSeconds;
        if (dist > 5) {
            const angle = Math.atan2(this.targetY - this.y, this.targetX - this.x);
            this.x += Math.cos(angle) * Math.min(dist, step);
            this.y += Math.sin(angle) * Math.min(dist, step);
        }

        if (this.wMarked && performance.now() - this.wMarkTime > 4000) {
            this.wMarked = false;
        }
    }
}

class Ezreal extends Champion {
    constructor(x, y) {
        super('Ezreal', x, y, '#3498db', 'blue');
        this.range = 320; // Bizim menzilimiz biraz daha fazla
        this.skills = {
            q: { cd: 4000, lastUsed: -4000 },
            w: { cd: 8000, lastUsed: -8000 },
            e: { cd: 12000, lastUsed: -12000 }
        };
    }

    useQ(tx, ty) {
        const now = performance.now();
        if (now - this.skills.q.lastUsed >= this.skills.q.cd) {
            projectiles.push(new Projectile(this.x, this.y, {x: tx, y: ty}, 100, '#81ecec', SPEEDS.ezrealQ, 'ezrealQ', this));
            this.skills.q.lastUsed = now;
            this.updateSkillUI('q');
        }
    }

    useW(tx, ty) {
        const now = performance.now();
        if (now - this.skills.w.lastUsed >= this.skills.w.cd) {
            projectiles.push(new Projectile(this.x, this.y, {x: tx, y: ty}, 0, '#f1c40f', SPEEDS.ezrealW, 'ezrealW', this));
            this.skills.w.lastUsed = now;
            this.updateSkillUI('w');
        }
    }

    useE(tx, ty) {
        const now = performance.now();
        if (now - this.skills.e.lastUsed >= this.skills.e.cd) {
            const angle = Math.atan2(ty - this.y, tx - this.x);
            const dist = Math.min(getDistance(this.x, this.y, tx, ty), 300);
            const startX = this.x;
            const startY = this.y;
            
            this.x += Math.cos(angle) * dist;
            this.y += Math.sin(angle) * dist;
            this.targetX = this.x;
            this.targetY = this.y;
            spawnBurst(startX, startY, '#74b9ff', 14, 0.8, 2.8, 0.5, 1, 2, 4);
            spawnBurst(this.x, this.y, '#81ecec', 16, 0.8, 3.2, 0.5, 1, 2, 4);
            spawnLineBurst(startX, startY, this.x, this.y, '#dfe6e9', 18, 1.2, 2.8);

            let boltTarget = null;
            const boltRange = this.range + 10;

            if (enemy.wMarked && getDistance(this.x, this.y, enemy.x, enemy.y) <= boltRange) {
                boltTarget = enemy;
            } else if (getDistance(this.x, this.y, enemy.x, enemy.y) <= boltRange) {
                boltTarget = enemy;
            }

            if (boltTarget) {
                projectiles.push(new Projectile(this.x, this.y, boltTarget, 80, '#fab1a0', 15, 'ezrealE', this));
            }

            this.skills.e.lastUsed = now;
            this.updateSkillUI('e');
        }
    }

    updateSkillUI(key) {
        const skill = this.skills[key];
        const overlay = document.querySelector(`#skill-${key} .cooldown-overlay`);
        overlay.style.height = '100%';
        
        const startTime = performance.now();
        const interval = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const percent = 100 - (elapsed / skill.cd * 100);
            if (percent <= 0) {
                overlay.style.height = '0%';
                clearInterval(interval);
            } else {
                overlay.style.height = percent + '%';
            }
        }, 50);
    }
}

class Caitlyn extends Champion {
    constructor(x, y) {
        super('Caitlyn', x, y, '#9b59b6', 'red');
        this.range = 300; // Menzil Ezreal'dan biraz az
        this.speed = 180; // Rakip daha yavaş (Orijinal: 250)
        this.skills = {
            q: { cd: 10000, lastUsed: -10000 }
        };
        this.lastTradeTime = 0;
    }

    update(deltaSeconds) {
        super.update(deltaSeconds);
        if (!gameRunning) return;

        const now = performance.now();
        const enemyMinions = minions.filter(m => m.team === 'blue');
        const allyMinions = minions.filter(m => m.team === 'red');
        const distToEz = getDistance(this.x, this.y, player.x, player.y);

        // Hareket Hedefi Belirleme (Öncelikli)
        let moveTargetX = this.x;
        let moveTargetY = this.y;
        let actionTaken = false;

        // 1. Skill Dodge (Yüksek Öncelik)
        let needsDodge = false;
        projectiles.forEach(p => {
            if (p.active && (p.type === 'ezrealQ' || p.type === 'ezrealW' || p.type === 'ezrealE') && p.owner === player) {
                const dist = getDistance(this.x, this.y, p.x, p.y);
                if (dist < 200) { // Biraz daha erken fark etsin
                    const angleToMe = Math.atan2(this.y - p.y, this.x - p.x);
                    let angleDiff = angleToMe - p.angle;
                    // Açıyı normalize et (-PI to PI)
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                    angleDiff = Math.abs(angleDiff);

                    if (angleDiff < 0.6 && Math.random() < 0.04) { // %4 şansla tepki verir (Daha da yavaşladı)
                        needsDodge = true;
                        const dodgeDir = Math.random() < 0.5 ? 1 : -1;
                        moveTargetX = this.x + Math.cos(p.angle + Math.PI/2 * dodgeDir) * 100;
                        moveTargetY = this.y + Math.sin(p.angle + Math.PI/2 * dodgeDir) * 100;
                        actionTaken = true;
                    }
                }
            }
        });

        // 2. Güvenli Pozisyon Alma (Safe Positioning) - Eğer dodge gerekmiyorsa
        if (!needsDodge) {
            let bestMinion = null;
            let minDistToEz = Infinity;
            
            // Ezreal'a en yakın ama arkasında durabileceğim minyonu bul
            allyMinions.forEach(m => {
                const d = getDistance(m.x, m.y, player.x, player.y);
                if (d < minDistToEz) {
                    minDistToEz = d;
                    bestMinion = m;
                }
            });

            if (bestMinion) {
                // Minyonun arkasında, Ezreal'dan uzak tarafta dur
                const angleFromEz = Math.atan2(bestMinion.y - player.y, bestMinion.x - player.x);
                moveTargetX = bestMinion.x + Math.cos(angleFromEz) * 80;
                moveTargetY = bestMinion.y + Math.sin(angleFromEz) * 80;
                
                // Eğer minyon yoksa veya safe zone dışındaysa düzelt
                const safeZoneX = canvas.width / 2 + 50;
                if (moveTargetX < safeZoneX) moveTargetX = safeZoneX;
                actionTaken = true;
            } else {
                 // Hiç minyon yoksa kule altına (geriye) kaç
                 moveTargetX = canvas.width - 150;
                 moveTargetY = canvas.height / 2;
                 actionTaken = true;
            }
        }

        // 3. Farm ve Trade Mantığı (Saldırı)
        // Hareket hedefi belirlense bile, saldırı menzilindeyse saldırabilir
        let lastHitTarget = null;
        let closestMinion = null;
        let closestMinionDist = Infinity;

        enemyMinions.forEach(m => {
            const dist = getDistance(this.x, this.y, m.x, m.y);
            if (dist < closestMinionDist) {
                closestMinionDist = dist;
                closestMinion = m;
            }
            if (dist <= this.range + m.radius && m.health <= this.damage + 6) {
                if (!lastHitTarget || m.health < lastHitTarget.health) lastHitTarget = m;
            }
        });

        // Q Kullanımı
        if (now - this.skills.q.lastUsed >= this.skills.q.cd) {
            if (distToEz < this.range + 140 && Math.random() < 0.02) { // %2 şansla her karede dener (agresif değil)
                projectiles.push(new Projectile(this.x, this.y, {x: player.x, y: player.y}, 120, '#d63031', SPEEDS.caitlynQ, 'caitlynQ', this));
                this.skills.q.lastUsed = now;
            } else if (enemyMinions.length > 2) {
                // Minyon temizleme Q'su
                 const qTargets = enemyMinions.filter(m => getDistance(this.x, this.y, m.x, m.y) < 600);
                 if (qTargets.length >= 3 && Math.random() < 0.01) {
                    let avgX = 0, avgY = 0;
                    qTargets.forEach(m => { avgX += m.x; avgY += m.y; });
                    avgX /= qTargets.length;
                    avgY /= qTargets.length;
                    projectiles.push(new Projectile(this.x, this.y, {x: avgX, y: avgY}, 120, '#d63031', SPEEDS.caitlynQ, 'caitlynQ', this));
                    this.skills.q.lastUsed = now;
                 }
            }
        }

        // Düz Vuruş
        if (lastHitTarget) {
            // Last hit yapabiliyorsak yapalım
            if (getDistance(this.x, this.y, lastHitTarget.x, lastHitTarget.y) <= this.range) {
                if (now - this.lastAttackTime > 1000 / this.attackSpeed) {
                    projectiles.push(new Projectile(this.x, this.y, lastHitTarget, this.damage, this.color, 7, 'basic', this));
                    this.lastAttackTime = now;
                }
            } else {
                // Menzil dışındaysa ve dodge yapmıyorsak ona yaklaş
                if (!needsDodge) {
                    moveTargetX = lastHitTarget.x + 150; // Biraz uzakta dur
                    moveTargetY = lastHitTarget.y;
                    actionTaken = true;
                }
            }
        } else if (distToEz < this.range && (enemyMinions.length === 0 || Math.random() < 0.05)) {
            // Trade
            if (now - this.lastAttackTime > 1000 / this.attackSpeed) {
                projectiles.push(new Projectile(this.x, this.y, player, this.damage, this.color, 7, 'basic', this));
                this.lastAttackTime = now;
                this.lastTradeTime = now;
            }
        }

        // Eğer hiçbir aksiyon alınmadıysa (dodge yok, minyon yok), idle gez
        if (!actionTaken && !closestMinion) {
             if (Math.random() < 0.01) {
                moveTargetX = canvas.width * 0.7 + Math.random() * 120;
                moveTargetY = canvas.height / 2 + (Math.random() - 0.5) * 200;
             } else {
                 // Mevcut hedefi koru
                 moveTargetX = this.targetX;
                 moveTargetY = this.targetY;
             }
        }

        // Sınır Kontrolü (Tekrar)
        const safeZoneLimit = canvas.width / 2 + 60;
        if (moveTargetX < safeZoneLimit) moveTargetX = safeZoneLimit;

        // Hedefi Güncelle
        // Yumuşak geçiş yerine direkt atama yapalım ki tepki versin
        this.targetX = moveTargetX;
        this.targetY = moveTargetY;
    }
}

const player = new Ezreal(200, canvas.height / 2);
const enemy = new Caitlyn(canvas.width - 200, canvas.height / 2);

class Minion {
    constructor(team, type, x, y) {
        this.team = team;
        this.type = type;
        this.radius = type === 'melee' ? 18 : 15;
        this.x = x;
        this.y = y;
        this.maxHealth = type === 'melee' ? 450 : 280;
        this.health = this.maxHealth;
        this.damage = type === 'melee' ? 12 : 24;
        this.range = type === 'melee' ? 40 : 250;
        this.attackCooldown = type === 'melee' ? 1200 : 1500;
        this.color = team === 'blue' ? '#3498db' : '#e74c3c';
        this.lastAttackTime = 0;
        this.target = null;
        this.speed = SPEEDS.minion;
    }

    findTarget() {
        let nearestDist = Infinity;
        let potentialTarget = null;
        const enemyMinions = minions.filter(m => m.team !== this.team);
        const enemyChamp = (this.team === 'blue') ? enemy : player;

        // 1. Önce düşman minyonlarını ara (Minyon Önceliği)
        enemyMinions.forEach(t => {
            const dist = getDistance(this.x, this.y, t.x, t.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                potentialTarget = t;
            }
        });

        // 2. Eğer minyon yoksa, şampiyonu kontrol et (Menzil kontrolüyle)
        if (!potentialTarget) {
            const dist = getDistance(this.x, this.y, enemyChamp.x, enemyChamp.y);
            // Sadece yakındaysa (600 birim) şampiyona odaklan
            if (dist < 600) {
                potentialTarget = enemyChamp;
            }
        }
        
        this.target = potentialTarget;
    }

    update(deltaSeconds) {
        if (!this.target || this.target.health <= 0) {
            this.findTarget();
        }

        if (this.target) {
            const dist = getDistance(this.x, this.y, this.target.x, this.target.y);
            const attackDist = this.range + this.radius + this.target.radius;

            if (dist > attackDist) {
                const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
                const moveStep = this.speed * (deltaSeconds * 60);
                this.x += Math.cos(angle) * moveStep;
                this.y += Math.sin(angle) * moveStep;
            } else {
                const now = performance.now();
                if (now - this.lastAttackTime > this.attackCooldown) {
                    projectiles.push(new Projectile(this.x, this.y, this.target, this.damage, this.color));
                    this.lastAttackTime = now;
                }
            }
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();

        const barWidth = 30;
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(this.x - barWidth/2, this.y - 25, barWidth, 4);
        ctx.fillStyle = this.team === 'blue' ? '#2ecc71' : '#e74c3c';
        ctx.fillRect(this.x - barWidth/2, this.y - 25, barWidth * healthPercent, 4);
    }
}

function spawnWave() {
    const centerY = canvas.height / 2;
    const spawnDist = 400;
    
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('blue', 'melee', 100, centerY - 100 + i * 100));
        minions.push(new Minion('red', 'melee', canvas.width - 100, centerY - 100 + i * 100));
    }
    for(let i = 0; i < 3; i++) {
        minions.push(new Minion('blue', 'ranged', 40, centerY - 100 + i * 100));
        minions.push(new Minion('red', 'ranged', canvas.width - 40, centerY - 100 + i * 100));
    }
}

function restartGame() {
    gameRunning = true;
    score = 0;
    missedCS = 0;
    if (missedCsEl) missedCsEl.innerText = MAX_MISSED_CS;
    scoreEl.innerText = score;
    minions = [];
    projectiles = [];
    particles = [];
    player.isDead = false;
    player.health = player.maxHealth;
    player.x = 200;
    player.y = canvas.height / 2;
    player.targetX = player.x;
    player.targetY = player.y;
    enemy.health = enemy.maxHealth;
    enemy.x = canvas.width - 200;
    enemy.y = canvas.height / 2;
    enemy.targetX = enemy.x;
    enemy.targetY = enemy.y;
    spawnWave();
    lastSpawnTime = performance.now();
    lastFrameTime = performance.now();
    accumulatorSeconds = 0;
    gameOverScreen.classList.add('hidden');
    const btn = document.querySelector('#game-over-screen button');
    if(btn) btn.style.display = 'block';
    requestAnimationFrame(gameLoop);
}

function updateStep(dt, timestamp) {
    if (timestamp - lastSpawnTime > spawnInterval) {
        spawnWave();
        lastSpawnTime = timestamp;
    }

    enemy.update(dt);
    minions.forEach(m => m.update(dt));
    resolveMinionCollisions();
    projectiles.forEach(p => p.update(dt));
    particles.forEach(p => p.update(dt));

    if (player.health <= 0) {
        if (!player.isDead) {
            player.isDead = true;
            player.respawnTime = performance.now() + 5000;
            failReasonEl.innerText = "Öldün! 5 saniye sonra doğacaksın...";
            gameOverScreen.classList.remove('hidden');
            const btn = document.querySelector('#game-over-screen button');
            if(btn) btn.style.display = 'none';
        } else if (performance.now() > player.respawnTime) {
            player.isDead = false;
            player.health = player.maxHealth;
            player.x = 200;
            player.y = canvas.height / 2;
            player.targetX = 200;
            player.targetY = canvas.height / 2;
            gameOverScreen.classList.add('hidden');
            const btn = document.querySelector('#game-over-screen button');
            if(btn) btn.style.display = 'block';
        }
    } else if (enemy.health <= 0) {
        enemy.health = enemy.maxHealth;
        enemy.x = canvas.width - 200;
        enemy.y = canvas.height / 2;
        score += 5;
        scoreEl.innerText = score;
        spawnBurst(enemy.x, enemy.y, '#e74c3c', 30, 2, 6, 1, 2, 4, 8);
    }

    if (!player.isDead) {
        if (pendingAttackTarget) {
            if (!pendingAttackTarget.health || pendingAttackTarget.health <= 0) {
                clearAttackOrder();
            } else {
                const distToTarget = getDistance(player.x, player.y, pendingAttackTarget.x, pendingAttackTarget.y);
                const inRange = distToTarget <= player.range + pendingAttackTarget.radius;
                if (inRange) {
                    const now = performance.now();
                    if (now - player.lastAttackTime > 1000 / player.attackSpeed) {
                        projectiles.push(new Projectile(player.x, player.y, pendingAttackTarget, player.damage, player.color, 7, 'basic', player));
                        player.lastAttackTime = now;
                        player.targetX = player.x;
                        player.targetY = player.y;
                        clearAttackOrder();
                    }
                } else {
                    player.targetX = pendingAttackTarget.x;
                    player.targetY = pendingAttackTarget.y;
                }
            }
        }
        player.update(dt);
    }
}

function gameLoop(timestamp) {
    if (!gameRunning) return;

    const frameDt = Math.min((timestamp - lastFrameTime) / 1000, 0.25);
    lastFrameTime = timestamp;
    accumulatorSeconds += frameDt;

    let steps = 0;
    while (accumulatorSeconds >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        deltaSeconds = FIXED_DT;
        updateStep(FIXED_DT, timestamp);
        accumulatorSeconds -= FIXED_DT;
        steps++;
    }

    minions = minions.filter(m => m.health > 0);
    projectiles = projectiles.filter(p => p.active);
    particles = particles.filter(p => p.active);

    draw();
    requestAnimationFrame(gameLoop);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Background (River/Lane)
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    minions.forEach(m => m.draw());
    if (!player.isDead) player.draw();
    enemy.draw();
    projectiles.forEach(p => p.draw());
    particles.forEach(p => p.draw());

    if (isAttackMode) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.stroke();
    }
}

// Input Handlers
window.addEventListener('keydown', (e) => {
    if (isBindingKey || !gameRunning || player.isDead) return;
    if (e.code === 'KeyQ') player.useQ(mouseX, mouseY);
    if (e.code === 'KeyW') player.useW(mouseX, mouseY);
    if (e.code === 'KeyE') player.useE(mouseX, mouseY);
    if (e.code === 'KeyS') {
        isAttackMode = false;
        clearAttackOrder();
        player.targetX = player.x;
        player.targetY = player.y;
    }
    if (e.code === attackKey) isAttackMode = true;
});

let mouseX = player.x, mouseY = player.y;
window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

window.addEventListener('mousedown', (e) => {
    if (!gameRunning || player.isDead) return;
    if (e.button === 2) {
        isAttackMode = false;
        clearAttackOrder();
        let target = null;
        [...minions.filter(m => m.team === 'red'), enemy].forEach(u => {
            if (getDistance(e.clientX, e.clientY, u.x, u.y) < u.radius + 10) target = u;
        });
        if (target) {
            setAttackOrder(target);
        } else {
            player.targetX = e.clientX;
            player.targetY = e.clientY;
        }
    }
});

window.addEventListener('click', (e) => {
    if (!gameRunning || player.isDead) return;
    if (isAttackMode) {
        clearAttackOrder();
        let target = null;
        [...minions.filter(m => m.team === 'red'), enemy].forEach(u => {
            if (getDistance(e.clientX, e.clientY, u.x, u.y) < u.radius + 10) target = u;
        });
        
        if (!target) {
            let minDist = Infinity;
            [...minions.filter(m => m.team === 'red'), enemy].forEach(u => {
                const d = getDistance(player.x, player.y, u.x, u.y);
                if (d < minDist && d <= player.range + u.radius) {
                    minDist = d;
                    target = u;
                }
            });
        }

        if (target) {
            setAttackOrder(target);
        } else {
            player.targetX = e.clientX;
            player.targetY = e.clientY;
        }
        isAttackMode = false;
    }
});

window.addEventListener('contextmenu', e => e.preventDefault());

spawnWave();
requestAnimationFrame(gameLoop);
