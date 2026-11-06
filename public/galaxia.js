// "Universo" do Cérebro, em WebGL2.
// No centro, um buraco negro com lente gravitacional calculada raio a raio: é o conhecimento base
// (o mapa do cérebro, as skills, o jeito de aprender). Em volta, cada equipe é uma galáxia espiral que vai
// se formando conforme ela aprende: cada nota é uma estrela, as validadas brilham mais.
// Dá para girar, aproximar, afastar e entrar numa galáxia; de perto aparecem as ligações entre as notas,
// com pulsos correndo por elas. Notas usadas agora acendem, e cada mensagem vira um cometa entre as galáxias.

const MAX_GAL = 32;
const K = 3.2; // escala do buraco negro no mundo (o shader trabalha com horizonte = 1)
const SOMBRA = 2.62 * K; // raio aparente da sombra (3√3/2 raios de Schwarzschild)

// ------------------------------------------------------------------ utilidades

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000003) / 1000003;
};
const aleatorio = (semente) => {
  let x = Math.floor(semente * 2147483646) + 1;
  return () => ((x = (x * 48271) % 2147483647) / 2147483647);
};
const gauss = (r) => {
  const u = Math.max(1e-6, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
const rgb = (hex) => {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const suave = (t) => t * t * (3 - 2 * t);
const entre = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));

// ------------------------------------------------------------------ shaders

const VS_TELA = `#version 300 es
in vec2 aP; out vec2 vUv;
void main(){ vUv = aP; gl_Position = vec4(aP, 0.0, 1.0); }`;

// Buraco negro: cada pixel é um raio de luz que a gravidade curva (aproximação de Schwarzschild, rs = 1).
const FS_BURACO = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 cor;
uniform vec3 uOlho, uDir, uCima, uFrente;
uniform float uTan, uAspecto, uTempo, uAtiv, uBase, uEsc;
float uLonge;

float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float h31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float ruido(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*ruido(p); p = p*2.03 + 17.1; a *= 0.5; } return v; }

vec3 ceu(vec3 d){
  vec3 c = vec3(0.0);
  // estrelas de fundo (desviadas pela lente quando passam perto do buraco)
  for(int k=0;k<2;k++){
    float esc = k==0 ? 260.0 : 120.0;
    vec3 q = d*esc; vec3 i = floor(q);
    float h = h31(i + float(k)*31.0);
    if(h > (k==0 ? 0.9965 : 0.9985)){
      vec3 centro = i + 0.5 + 0.35*(vec3(h31(i+1.7), h31(i+3.1), h31(i+5.3))-0.5);
      float dd = length(q - centro);
      float b = (k==0 ? 0.5 : 1.0) * smoothstep(0.5, 0.0, dd) * (0.4 + 0.6*h31(i+9.0));
      vec3 tom = mix(vec3(0.75,0.7,1.0), vec3(1.0,0.85,0.95), h31(i+4.0));
      c += tom*b;
    }
  }
  // nebulosa bem fraca, roxa
  vec2 uv = vec2(atan(d.z, d.x), asin(clamp(d.y,-1.0,1.0)));
  float n = fbm(uv*vec2(1.6, 2.4) + 3.0);
  float n2 = fbm(uv*vec2(3.2, 4.8) - 7.0);
  c += vec3(0.16,0.07,0.32) * pow(n, 3.0) * 0.55 + vec3(0.25,0.06,0.22) * pow(n2, 4.0) * 0.35;
  return c;
}

// Cor e opacidade do disco de acreção no ponto p (no plano y = 0).
vec4 disco(vec3 p, vec3 rd){
  float r = length(p.xz);
  if(r < 2.45 || r > 15.5) return vec4(0.0);
  float ang = atan(p.z, p.x);
  float giro = uTempo * (0.55 + 0.6*uAtiv) * pow(r, -1.5) * 3.0;
  float a = ang + giro;
  vec2 q = r * vec2(cos(a), sin(a));
  float n1 = fbm(q*0.9);
  float n2 = fbm(q*2.7 + 5.0);
  float n3 = fbm(vec2(r*5.0, a*2.0));
  // os fios finos somem de longe (senão viram serrilhado)
  float fino = 1.0 - smoothstep(14.0, 40.0, uLonge);
  float medio = 1.0 - smoothstep(30.0, 90.0, uLonge);
  float aneis = 0.74 + 0.26*sin(r*7.0 + n1*6.0);
  float detalhe = mix(1.0, 0.82 + 0.18*sin(r*21.0 + n2*5.0), medio) * mix(1.0, 0.9 + 0.1*sin(r*47.0 + n3*7.0), fino);
  float nuvem = 0.25 + 1.1*pow(n1, 1.4) + 0.45*n2*n2;
  float dens = aneis * detalhe * nuvem * smoothstep(2.45, 3.4, r) * (1.0 - smoothstep(8.5, 15.5, r));
  float temp = clamp(pow(3.0/r, 1.35), 0.0, 1.6);
  vec3 c = mix(vec3(0.38,0.08,0.50), vec3(0.62,0.36,1.0), smoothstep(0.12, 0.42, temp));
  c = mix(c, vec3(0.95,0.72,1.0), smoothstep(0.42, 0.8, temp));
  c = mix(c, vec3(1.0,0.95,0.97), smoothstep(0.8, 1.2, temp));
  // Doppler: o lado que vem na sua direção brilha mais
  vec3 tang = normalize(vec3(-p.z, 0.0, p.x));
  float beta = 0.42 * sqrt(3.0 / r);
  float dop = clamp(1.0 + beta * dot(tang, -rd), 0.35, 1.9);
  float e = dens * (0.18 + 3.4*pow(temp, 1.6)) * dop*dop*dop * (1.0 + 0.7*uAtiv);
  return vec4(c*e, clamp(dens*0.8, 0.0, 0.94));
}

void main(){
  vec3 rd = normalize(uFrente + vUv.x*uTan*uAspecto*uDir + vUv.y*uTan*uCima);
  vec3 pos = uOlho / uEsc;
  uLonge = length(pos);
  // parâmetro de impacto: raios que passam longe nem entram no laço
  vec3 hv = cross(pos, rd);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float longe = length(pos);
  if(h2 >= 26.0*26.0){
    // Longe do buraco: desvio fraco, que muda suave com a direção. Olhando para o buraco o raio passa por ele
    // inteiro (2/b); de lado, metade; olhando para longe, quase nada. Sem degrau, o céu não ganha "corte".
    float b = sqrt(h2);
    vec3 paraCentro = normalize(-(pos - dot(pos, rd)*rd));
    float c = dot(normalize(-pos), rd);
    rd = normalize(rd + paraCentro * ((1.0 + c) / b));
  } else {
    // avança em linha reta até a esfera de raio 28
    float R0 = 28.0;
    float b = dot(pos, rd), c0 = dot(pos,pos) - R0*R0;
    if(c0 > 0.0){ float disc = b*b - c0; if(disc > 0.0) pos += rd * max(0.0, -b - sqrt(disc)); }
    vec3 v = rd;
    for(int i=0;i<220;i++){
      float r2 = dot(pos,pos); float r = sqrt(r2);
      if(r < 1.0){ T = 0.0; break; }
      float dt = clamp(0.07*r, 0.025, 1.6);
      vec3 ac = -1.5 * h2 * pos / (r2*r2*r);
      vec3 ant = pos;
      v += ac*dt;
      pos += v*dt;
      // névoa luminosa em volta do disco (dá o brilho difuso, como bloom)
      float rx = length(pos.xz);
      if(rx < 17.0){
        float hz = exp(-abs(pos.y)*2.2) * smoothstep(2.3, 3.6, rx) * (1.0 - smoothstep(7.0, 17.0, rx)) * pow(3.0/rx, 1.6);
        col += T * vec3(0.55,0.32,0.95) * hz * dt * (0.05 + 0.04*uAtiv);
      }
      if(ant.y*pos.y < 0.0){
        float t = ant.y/(ant.y-pos.y);
        vec4 d = disco(mix(ant, pos, t), normalize(v));
        col += T * d.rgb * d.a;
        T *= 1.0 - d.a;
        if(T < 0.02) break;
      }
      if(r > 34.0 && dot(pos, v) > 0.0) break;
    }
    rd = normalize(v);
    // anel de fótons: um fio de luz bem na borda da sombra
    float bb = sqrt(h2);
    col += vec3(0.85,0.75,1.0) * exp(-pow((bb-2.62)/0.022, 2.0)) * (0.25 + 0.9*uBase) * T;
  }
  col += T * ceu(rd);
  // brilho do conhecimento base em uso: um halo que respira
  float bb = sqrt(h2);
  col += vec3(0.55,0.35,1.0) * uBase * 0.25 * exp(-max(0.0, bb-2.6)*0.35) * (0.7 + 0.3*sin(uTempo*2.4));
  col = 1.0 - exp(-col * 1.5);
  col = pow(col, vec3(0.92));
  cor = vec4(col, 1.0);
}`;

// Comum aos pontos: projeção com a câmera e o "esconder atrás do buraco".
const PROJ = `
uniform vec3 uOlho, uDir, uCima, uFrente;
uniform float uTan, uAspecto, uPx;
vec4 projetar(vec3 p, out float z, out float oculto){
  vec3 v = p - uOlho;
  z = dot(v, uFrente);
  vec3 d = p - uOlho;
  float tt = clamp(dot(-uOlho, d)/max(dot(d,d), 1e-4), 0.0, 1.0);
  oculto = (length(uOlho + d*tt) < ${SOMBRA.toFixed(2)} && tt < 0.999) ? 1.0 : 0.0;
  if(z < 0.05) return vec4(2.0, 2.0, 2.0, 1.0);
  return vec4(dot(v,uDir)/(uTan*uAspecto), dot(v,uCima)/uTan, 0.0, z);
}`;

// Poeira das galáxias: posição calculada aqui, girando com a fase de cada galáxia.
const VS_POEIRA = `#version 300 es
precision highp float;
in vec4 aP; in float aGal; in vec4 aCor; in float aTam;
uniform vec3 uCentro[${MAX_GAL}], uEx[${MAX_GAL}], uEy[${MAX_GAL}], uEz[${MAX_GAL}];
uniform float uFase[${MAX_GAL}], uBrilho[${MAX_GAL}], uRaio[${MAX_GAL}];
${PROJ}
out vec4 vCor;
void main(){
  int g = int(aGal);
  float R = uRaio[g];
  float w = 1.0 / (aP.x/R + 0.25);
  float a = aP.y + uFase[g]*w;
  vec3 p = uCentro[g] + uEx[g]*(aP.x*cos(a)) + uEy[g]*aP.z + uEz[g]*(aP.x*sin(a));
  float z, oc;
  gl_Position = projetar(p, z, oc);
  float px = aTam * uPx / max(z, 0.05);
  float pe = clamp(px, 1.0, 28.0);
  float sub = clamp(px, 0.06, 1.0);
  gl_PointSize = pe;
  float perto = smoothstep(0.3, 2.5, z);
  vCor = vec4(aCor.rgb, aCor.a * uBrilho[g] * sub * perto * (1.0 - oc));
}`;

const FS_PONTO = `#version 300 es
precision highp float;
in vec4 vCor; out vec4 cor;
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0; float d2 = dot(q,q);
  if(d2 > 1.0) discard;
  float a = exp(-d2*4.5);
  cor = vec4(vCor.rgb * vCor.a * a, 0.0);
}`;

// Estrelas que são notas (e cometas, núcleos de galáxia): núcleo, halo e anel quando estão em uso.
const VS_ESTRELA = `#version 300 es
precision highp float;
in vec3 aP; in vec4 aCor; in vec2 aTam; // tamanho (mundo), brilho de uso 0..1
${PROJ}
uniform float uTempo;
out vec4 vCor; out float vUso;
void main(){
  float z, oc;
  gl_Position = projetar(aP, z, oc);
  float px = aTam.x * uPx / max(z, 0.05);
  gl_PointSize = clamp(px * (1.0 + 1.6*aTam.y), 2.0, 160.0);
  float sub = clamp(px/2.0, 0.15, 1.0);
  vCor = vec4(aCor.rgb, aCor.a * sub * (1.0 - oc));
  vUso = aTam.y;
}`;

const FS_ESTRELA = `#version 300 es
precision highp float;
in vec4 vCor; in float vUso; out vec4 cor;
uniform float uTempo;
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0; float d = length(q);
  if(d > 1.0) discard;
  float k = 1.0 + 1.6*vUso;          // o sprite cresce quando a nota está em uso; o núcleo continua do mesmo tamanho
  float dn = d*k;
  float nucleo = exp(-dn*dn*28.0);
  float halo = exp(-dn*dn*3.2) * 0.45;
  float raios = (exp(-abs(q.x)*k*40.0) + exp(-abs(q.y)*k*40.0)) * exp(-dn*dn*1.5) * 0.25;
  float pulso = 0.5 + 0.5*sin(uTempo*4.0);
  float anel = vUso * smoothstep(0.07, 0.0, abs(d - (0.55 + 0.25*pulso))) * 0.9;
  float luz = vUso * exp(-d*d*2.2) * 0.5;
  vec3 branco = mix(vCor.rgb, vec3(1.0), 0.65);
  vec3 c = branco*nucleo*1.4 + vCor.rgb*(halo + raios) + vCor.rgb*(anel + luz);
  cor = vec4(c * vCor.a, 0.0);
}`;

// Ligações: linhas finas com pulsos de luz correndo (a conversa entre as notas).
const VS_LINHA = `#version 300 es
precision highp float;
in vec3 aP; in vec4 aCor; in vec3 aFase;
${PROJ}
out vec4 vCor; out vec3 vFase;
void main(){
  float z, oc;
  gl_Position = projetar(aP, z, oc);
  vCor = vec4(aCor.rgb, aCor.a * (1.0 - 0.8*oc)); vFase = aFase;
}`;
const FS_LINHA = `#version 300 es
precision highp float;
in vec4 vCor; in vec3 vFase; out vec4 cor;
uniform float uTempo;
void main(){
  float x = fract(vFase.x - uTempo*vFase.y);
  float pulso = pow(1.0 - x, 14.0) * vFase.z;
  cor = vec4(vCor.rgb * (vCor.a + pulso), 0.0);
}`;

// ------------------------------------------------------------------ o universo

export const suportaGalaxia = () => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
};

export const criarGalaxia = (caixa, op = {}) => {
  const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'gx-tela';
  const camada = document.createElement('div');
  camada.className = 'gx-rotulos';
  camada.setAttribute('aria-hidden', 'true');
  caixa.append(canvas, camada);
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false });
  if (!gl) throw new Error('sem WebGL2');

  const compilar = (vs, fs) => {
    const p = gl.createProgram();
    for (const [tipo, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const nome = gl.getActiveUniform(p, i).name.replace('[0]', '');
      u[nome] = gl.getUniformLocation(p, nome);
    }
    return { p, u, a: (nome) => gl.getAttribLocation(p, nome) };
  };
  const P = {
    buraco: compilar(VS_TELA, FS_BURACO),
    poeira: compilar(VS_POEIRA, FS_PONTO),
    estrela: compilar(VS_ESTRELA, FS_ESTRELA),
    linha: compilar(VS_LINHA, FS_LINHA),
  };

  // quadrado da tela inteira
  const vaoTela = gl.createVertexArray();
  gl.bindVertexArray(vaoTela);
  const bTela = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bTela);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(P.buraco.a('aP'));
  gl.vertexAttribPointer(P.buraco.a('aP'), 2, gl.FLOAT, false, 0, 0);

  // buffers dinâmicos (estrelas e linhas) com layout fixo
  const dinamico = (prog, campos) => {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const passo = campos.reduce((s, [, n]) => s + n, 0) * 4;
    let off = 0;
    for (const [nome, n] of campos) {
      const loc = prog.a(nome);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, passo, off);
      }
      off += n * 4;
    }
    return { vao, buf, por: passo / 4, n: 0 };
  };
  const dEstrela = dinamico(P.estrela, [['aP', 3], ['aCor', 4], ['aTam', 2]]);
  const dLinha = dinamico(P.linha, [['aP', 3], ['aCor', 4], ['aFase', 3]]);
  const vaoPoeira = gl.createVertexArray();
  const bPoeira = gl.createBuffer();
  let nPoeira = 0;

  // ------------------------------------------------------------------ estado

  const U = {
    gal: [], // galáxias
    porChave: new Map(),
    notas: new Map(), // id -> { id, titulo, g (índice ou -1 = base), r, th, h, validado, nasceu, cor }
    base: [],
    links: [],
    nivel: new Map(),
    uso: new Map(), // id da nota -> instante em que foi usada
    baseUso: 0,
    ativGeral: 0,
    cometas: [],
    foco: null,
    sel: null,
    hover: null,
    busca: '',
    cam: { alvo: [0, 0, 0], yaw: 0.65, pitch: 0.22, dist: 210 },
    voo: null,
    ocioso: 0,
    t0: performance.now(),
    tempo: 0,
    ultimo: performance.now(),
    vivo: true,
    proj: [], // pontos clicáveis na tela
    tamanho: [1, 1],
  };

  // Lugar de cada galáxia: um anel largo em volta do buraco, com alturas e inclinações variadas.
  const montarGalaxias = (lista) => {
    const n = lista.length;
    U.gal = lista.map((g, i) => {
      const h = hash(g.chave);
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + h * 0.6;
      const raioOrb = 92 + (i % 3) * 20 + h * 12;
      const centro = [Math.cos(ang) * raioOrb, (h - 0.5) * 50, Math.sin(ang) * raioOrb];
      const inclina = 0.35 + hash(`${g.chave}i`) * 0.9;
      const giroN = hash(`${g.chave}g`) * Math.PI * 2;
      const ey = norm([Math.sin(inclina) * Math.cos(giroN), Math.cos(inclina), Math.sin(inclina) * Math.sin(giroN)]);
      const ex = norm(cross(ey, Math.abs(ey[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const ez = cross(ex, ey);
      const base = g.notas.filter((x) => (x.camada ?? 'conhecimento') === 'conhecimento');
      const validadas = base.filter((x) => x.validado).length;
      const forma = Math.min(1, (validadas + 0.45 * (base.length - validadas)) / 6); // 0 = nuvem se formando, 1 = espiral pronta
      const raio = 9 + 3.2 * Math.sqrt(g.notas.length + 1);
      return { ...g, i, centro, ex, ey, ez, raio, forma, rgb: rgb(g.cor), bracos: hash(`${g.chave}b`) > 0.55 ? 3 : 2, fase: hash(`${g.chave}f`) * 50, brilho: 1, ativ: 0 };
    });
    U.porChave = new Map(U.gal.map((g) => [g.chave, g]));
  };

  // Posição de um ponto da espiral (raio r em unidades da galáxia).
  const braco = (g, rnd, r) => {
    const k = 0.32;
    const b = Math.floor(rnd() * g.bracos);
    const desordem = (1 - g.forma) * Math.PI * 1.6;
    return (b / g.bracos) * Math.PI * 2 + Math.log(r / g.raio + 0.05) / k + gauss(rnd) * (0.28 + 0.15 * (1 - g.forma)) + (rnd() - 0.5) * desordem;
  };

  const gerarPoeira = () => {
    const dados = [];
    for (const g of U.gal) {
      const rnd = aleatorio(hash(`${g.chave}p`));
      const total = Math.min(5200, 1400 + 260 * g.notas.length);
      const branco = [1, 0.96, 1];
      const quente = [1, 0.82, 0.92];
      for (let i = 0; i < total; i++) {
        const t = rnd();
        let r, th, h, cor, a, tam;
        if (t < 0.22) {
          // bojo: denso, quente, quase esférico
          r = Math.abs(gauss(rnd)) * g.raio * 0.16;
          th = rnd() * Math.PI * 2;
          h = gauss(rnd) * g.raio * 0.07;
          cor = mix(quente, g.rgb, rnd() * 0.35);
          a = 0.5 + rnd() * 0.5;
          tam = 0.09 + rnd() * 0.08;
        } else if (t < 0.93) {
          // braços
          r = g.raio * Math.pow(rnd(), 0.75) + 0.2;
          th = braco(g, rnd, r);
          h = gauss(rnd) * g.raio * 0.025 * (1.2 - r / g.raio);
          const azul = rnd() < 0.18;
          cor = azul ? mix([0.75, 0.75, 1], g.rgb, 0.3) : mix(g.rgb, branco, rnd() * 0.45);
          a = 0.35 + rnd() * 0.55;
          tam = 0.06 + rnd() * 0.07;
          if (rnd() < 0.035) {
            // nuvens de formação (rosadas) ao longo dos braços
            cor = mix([1, 0.45, 0.8], g.rgb, 0.4);
            tam = 0.35 + rnd() * 0.5;
            a = 0.18;
          }
        } else {
          // halo esparso
          r = g.raio * (0.6 + rnd() * 0.9);
          th = rnd() * Math.PI * 2;
          h = gauss(rnd) * g.raio * 0.18;
          cor = mix(g.rgb, branco, 0.3);
          a = 0.25 + rnd() * 0.3;
          tam = 0.05 + rnd() * 0.05;
        }
        dados.push(r, th, h, rnd(), g.i, cor[0], cor[1], cor[2], a, tam);
      }
    }
    // poeira do disco do buraco (fora do alcance do shader): estrelas velhas orbitando
    nPoeira = dados.length / 10;
    gl.bindVertexArray(vaoPoeira);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPoeira);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dados), gl.STATIC_DRAW);
    const passo = 10 * 4;
    const at = (nome, n, off) => {
      const loc = P.poeira.a(nome);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, passo, off * 4);
    };
    at('aP', 4, 0);
    at('aGal', 1, 4);
    at('aCor', 4, 5);
    at('aTam', 1, 9);
  };

  // Lugar de cada nota: num braço da galáxia da equipe dela (ou orbitando o buraco, se for conhecimento base).
  const posicionarNotas = (velhas) => {
    U.notas = new Map();
    for (const g of U.gal) {
      g.notas.forEach((n) => {
        const rnd = aleatorio(hash(n.id));
        // Três caminhos: o conhecimento consolidado perto do núcleo da galáxia; casos de uso nos braços de fora;
        // como foi adquirido no halo, longe do centro (não é o que se consulta de cara).
        const camada = n.camada ?? 'conhecimento';
        const faixaR = camada === 'origem' ? [1.0, 0.3] : camada === 'caso' ? [0.72, 0.3] : [0.15, 0.55];
        const r = g.raio * (faixaR[0] + faixaR[1] * Math.pow(rnd(), 0.8));
        const h = gauss(rnd) * g.raio * (camada === 'origem' ? 0.12 : 0.02);
        const nota = { ...n, camada, g: g.i, r, th: braco(g, rnd, r), h, nasceu: velhas.get(n.id)?.nasceu ?? n.nasceu };
        U.notas.set(n.id, nota);
      });
    }
    U.base.forEach((n, i) => {
      const rnd = aleatorio(hash(n.id));
      const r = 54 + rnd() * 14;
      U.notas.set(n.id, { ...n, g: -1, r, th: (i / Math.max(1, U.base.length)) * Math.PI * 2 + rnd(), h: gauss(rnd) * 1.2, validado: true });
    });
  };

  const posNota = (n, fases) => {
    if (n.g < 0) {
      const a = n.th + U.tempo * 0.03 * Math.pow(54 / n.r, 1.5);
      const inc = 0.22;
      return [Math.cos(a) * n.r, n.h * 2 + Math.sin(a) * n.r * Math.sin(inc), Math.sin(a) * n.r * Math.cos(inc)];
    }
    const g = U.gal[n.g];
    const w = 1 / (n.r / g.raio + 0.25);
    const a = n.th + fases[n.g] * w;
    let r = n.r;
    const idade = n.nasceu ? (performance.now() - n.nasceu) / 1000 : 99;
    if (idade < 3) r *= 1 + (1 - suave(idade / 3)) * 1.4; // nota nova chega em espiral
    return add(g.centro, add(add(mul(g.ex, r * Math.cos(a)), mul(g.ey, n.h)), mul(g.ez, r * Math.sin(a))));
  };

  // ------------------------------------------------------------------ câmera

  const olho = () => {
    const c = U.cam;
    return add(c.alvo, mul([Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch) * Math.cos(c.yaw)], c.dist));
  };
  const base = () => {
    const e = olho();
    const f = norm(sub(U.cam.alvo, e));
    const d = norm(cross(f, [0, 1, 0]));
    const c = cross(d, f);
    return { e, f, d, c };
  };
  const TAN = Math.tan((50 * Math.PI) / 360);

  const paraTela = (p, B) => {
    const v = sub(p, B.e);
    const z = dot(v, B.f);
    if (z < 0.05) return null;
    const [w, h] = U.tamanho;
    const asp = w / h;
    return { x: (dot(v, B.d) / (TAN * asp * z) * 0.5 + 0.5) * w, y: (1 - (dot(v, B.c) / (TAN * z) * 0.5 + 0.5)) * h, z };
  };

  const voar = (alvo, dist, dir) => {
    const c = U.cam;
    let yaw = c.yaw;
    let pitch = c.pitch;
    if (dir) {
      yaw = Math.atan2(dir[0], dir[2]);
      pitch = Math.max(-1.35, Math.min(1.35, Math.asin(Math.max(-1, Math.min(1, dir[1])))));
      while (yaw - c.yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw - c.yaw < -Math.PI) yaw += Math.PI * 2;
    }
    U.voo = { de: { alvo: [...c.alvo], dist: c.dist, yaw: c.yaw, pitch: c.pitch }, para: { alvo, dist, yaw, pitch }, t: 0, dur: calmo ? 0.01 : 1.8 };
    U.ocioso = -6;
  };
  const voarGalaxia = (g, perto = false) => voar([...g.centro], g.raio * (perto ? 1.6 : 3.1), norm(add(mul(g.ey, 0.85), mul(g.ez, 0.55))));
  const visaoGeral = () => voar([0, 0, 0], 210, norm([Math.sin(U.cam.yaw), 0.22, Math.cos(U.cam.yaw)]));

  // ------------------------------------------------------------------ dados vindos da tela

  const dados = ({ galaxias, base: notasBase, links }) => {
    const velhas = U.notas;
    const assinatura = galaxias.map((g) => `${g.chave}:${g.notas.length}:${g.notas.filter((n) => n.validado).length}:${g.cor}`).join('|');
    U.base = notasBase;
    U.links = links;
    if (assinatura !== U.assinatura) {
      const fases = new Map(U.gal.map((g) => [g.chave, g.fase]));
      montarGalaxias(galaxias);
      for (const g of U.gal) if (fases.has(g.chave)) g.fase = fases.get(g.chave);
      gerarPoeira();
      U.assinatura = assinatura;
    } else {
      // mesmas galáxias: só atualiza notas (títulos, estado)
      for (const g of galaxias) {
        const gg = U.porChave.get(g.chave);
        if (gg) gg.notas = g.notas;
      }
    }
    posicionarNotas(velhas);
    if (U.foco && !U.porChave.has(U.foco)) U.foco = null;
  };

  // ------------------------------------------------------------------ quadro

  let bufE = new Float32Array(4096);
  let bufL = new Float32Array(8192);
  const garantir = (buf, n) => {
    if (buf.length >= n) return buf;
    let m = buf.length;
    while (m < n) m *= 2;
    return new Float32Array(m);
  };

  const uniformesCamera = (prog, B) => {
    gl.uniform3fv(prog.u.uOlho, B.e);
    gl.uniform3fv(prog.u.uDir, B.d);
    gl.uniform3fv(prog.u.uCima, B.c);
    gl.uniform3fv(prog.u.uFrente, B.f);
    gl.uniform1f(prog.u.uTan, TAN);
    gl.uniform1f(prog.u.uAspecto, U.tamanho[0] / U.tamanho[1]);
    if (prog.u.uPx) gl.uniform1f(prog.u.uPx, canvas.height / (2 * TAN));
    if (prog.u.uTempo) gl.uniform1f(prog.u.uTempo, U.tempo);
  };

  const medir = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, caixa.clientWidth);
    const h = Math.max(1, caixa.clientHeight);
    U.tamanho = [w, h];
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
  };

  const usoDe = (id, agora) => {
    const t = U.uso.get(id);
    if (!t) return 0;
    const n = U.notas.get(id);
    const g = n && n.g >= 0 ? U.gal[n.g] : null;
    const meia = g && g.ativ > 0.3 ? 90 : 30; // enquanto a equipe trabalha, a luz demora mais para apagar
    const v = Math.exp(-(agora - t) / 1000 / meia);
    if (v < 0.03) {
      U.uso.delete(id);
      return 0;
    }
    return v;
  };

  const quadro = () => {
    if (!U.vivo) return;
    medir();
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - U.ultimo) / 1000);
    U.ultimoVoo = U.ultimo;
    U.ultimo = agora;
    U.tempo = (agora - U.t0) / 1000;

    // atividade suavizada
    let soma = 0;
    for (const g of U.gal) {
      const alvo = U.nivel.get(g.chave) ?? 0;
      g.ativ += (alvo - g.ativ) * Math.min(1, dt * (alvo > g.ativ ? 3 : 0.8));
      soma += g.ativ;
      if (!calmo) g.fase += dt * 0.09 * (1 + 2.2 * g.ativ);
      const apagada = U.foco && U.foco !== g.chave ? 0.25 : 1;
      g.brilho += (apagada * (0.85 + 0.6 * g.ativ) - g.brilho) * Math.min(1, dt * 3);
    }
    U.ativGeral += (Math.min(1, soma / 2) - U.ativGeral) * Math.min(1, dt * 1.5);
    let baseAlvo = 0;
    for (const n of U.base) baseAlvo = Math.max(baseAlvo, usoDe(n.id, agora));
    U.baseUso += (baseAlvo - U.baseUso) * Math.min(1, dt * 2);

    // câmera: voo animado ou giro lento quando ninguém mexe
    if (U.voo) {
      const v = U.voo;
      v.t += Math.min(0.5, (agora - (U.ultimoVoo ?? agora - 16)) / 1000) / v.dur;
      const k = suave(Math.min(1, v.t));
      U.cam.alvo = mix(v.de.alvo, v.para.alvo, k);
      // a distância voa em escala log (aproxima e afasta com naturalidade)
      U.cam.dist = Math.exp(Math.log(v.de.dist) + (Math.log(v.para.dist) - Math.log(v.de.dist)) * k);
      U.cam.yaw = v.de.yaw + (v.para.yaw - v.de.yaw) * k;
      U.cam.pitch = v.de.pitch + (v.para.pitch - v.de.pitch) * k;
      if (v.t >= 1) U.voo = null;
    } else if (!calmo && !U.arrasto) {
      U.ocioso += dt;
      if (U.ocioso > 4) U.cam.yaw += dt * 0.018 * Math.min(1, (U.ocioso - 4) / 3);
    }

    // não deixa a câmera cair no horizonte (lá dentro tudo é preto)
    const e0 = olho();
    if (len(e0) < 1.4 * K) {
      const fora = add(mul(norm(e0), 1.4 * K), [0, 0, 0]);
      U.cam.alvo = add(U.cam.alvo, sub(fora, e0));
    }
    const B = base();
    const fases = U.gal.map((g) => g.fase);
    const busca = U.busca.trim().toLowerCase();

    // ---- estrelas (notas, núcleos, cometas) e linhas
    U.proj = [];
    const E = [];
    const L = [];
    const linha = (a, b, cor, alfa, fase = 0, vel = 0, pulso = 0) => {
      L.push(a[0], a[1], a[2], cor[0], cor[1], cor[2], alfa, 0 + fase, vel, pulso);
      L.push(b[0], b[1], b[2], cor[0], cor[1], cor[2], alfa, 1 + fase, vel, pulso);
    };
    const estrela = (p, cor, alfa, tam, uso) => E.push(p[0], p[1], p[2], cor[0], cor[1], cor[2], alfa, tam, uso);

    const pos = new Map();
    const pertoDe = new Map();
    for (const g of U.gal) {
      const dcam = len(sub(B.e, g.centro));
      const perto = entre(g.raio * 7, g.raio * 2.2, dcam); // 0 longe, 1 dentro
      pertoDe.set(g.i, perto);
      // brilho do núcleo da galáxia
      estrela(g.centro, mix(g.rgb, [1, 0.95, 1], 0.5), 0.55 * g.brilho, g.raio * 0.5, 0);
      if (g.ativ > 0.05) estrela(g.centro, g.rgb, 0.35 * g.ativ * g.brilho, g.raio * 1.1, 0.2 * g.ativ);
    }
    for (const n of U.notas.values()) {
      const p = posNota(n, fases);
      pos.set(n.id, p);
      const g = n.g >= 0 ? U.gal[n.g] : null;
      const cor = g ? g.rgb : [0.85, 0.78, 1];
      const uso = usoDe(n.id, agora);
      const casa = !busca || `${n.titulo} ${n.id}`.toLowerCase().includes(busca);
      const apaga = (U.foco && g && U.foco !== g.chave) || !casa ? 0.18 : 1;
      const foco = n.id === U.sel || n.id === U.hover;
      const idade = n.nasceu ? (agora - n.nasceu) / 1000 : 99;
      const tam = (g ? g.raio * 0.075 : 1.6) * (n.camada === 'origem' ? 0.5 : n.camada === 'caso' ? 0.7 : 1) * (n.validado ? 1.15 : 0.85) * (foco ? 1.6 : 1) * (busca && casa ? 1.5 : 1);
      const alfa = (n.validado ? 1 : 0.6) * (n.camada === 'origem' ? 0.55 : n.camada === 'caso' ? 0.8 : 1) * apaga * (g ? 0.55 + 0.45 * g.brilho : 1);
      estrela(p, cor, alfa, tam, Math.max(uso, idade < 4 ? 1 - idade / 4 : 0, foco ? 0.35 : 0));
      if (apaga > 0.5) U.proj.push({ tipo: 'nota', id: n.id, p, titulo: n.titulo, g: n.g, uso });
      // feixe de uso: a nota manda luz para o núcleo da galáxia (ou para o buraco, se for base)
      if (uso > 0.05) {
        const alvo = g ? g.centro : [0, 0, 0];
        linha(p, alvo, mix(cor, [1, 1, 1], 0.4), 0.35 * uso, hash(n.id), 0.9, 1.6 * uso);
      }
    }

    // fios da galáxia e ligações entre notas: só de perto
    for (const g of U.gal) {
      const perto = pertoDe.get(g.i);
      if (perto < 0.02) continue;
      const vel = 0.25 + 0.9 * g.ativ;
      for (const n of g.notas) {
        if ((n.camada ?? 'conhecimento') !== 'conhecimento') continue; // casos e origem chegam pelas ligações da nota
        const p = pos.get(n.id);
        if (p) linha(g.centro, p, g.rgb, 0.06 * perto * g.brilho, hash(n.id), vel, 0.5 * perto * (0.3 + g.ativ));
      }
    }
    for (const l of U.links) {
      const a = U.notas.get(l.de);
      const b = U.notas.get(l.para);
      if (!a || !b) continue;
      const pa = pos.get(l.de);
      const pb = pos.get(l.para);
      const pg = Math.max(a.g >= 0 ? pertoDe.get(a.g) : 0, b.g >= 0 ? pertoDe.get(b.g) : 0);
      const entreGal = a.g !== b.g;
      const alfa = entreGal ? 0.12 * pg : 0.22 * pg;
      if (alfa < 0.01) continue;
      const ga = a.g >= 0 ? U.gal[a.g] : null;
      const cor = ga ? mix(ga.rgb, [1, 1, 1], 0.35) : [0.85, 0.8, 1];
      const ativ = Math.max(ga?.ativ ?? 0, b.g >= 0 ? U.gal[b.g].ativ : 0);
      linha(pa, pb, cor, alfa, hash(l.de + l.para), 0.35 + 0.8 * ativ, (entreGal ? 0.6 : 0.9) * Math.max(pg, 0.3) * (0.4 + ativ));
    }

    // cometas (mensagens): curva de uma galáxia a outra, com cauda
    for (const c of U.cometas) c.t += dt / c.dur;
    U.cometas = U.cometas.filter((c) => c.t < 1);
    for (const c of U.cometas) {
      const ponto = (u) => {
        const a = c.de;
        const b = c.para;
        const m = add(mul(add(a, b), 0.5), c.alto);
        return add(add(mul(a, (1 - u) * (1 - u)), mul(m, 2 * u * (1 - u))), mul(b, u * u));
      };
      const u = suave(c.t);
      for (let k = 0; k < 12; k++) {
        const uu = Math.max(0, u - k * 0.012);
        estrela(ponto(uu), c.cor, (1 - k / 12) * 0.9 * (c.t > 0.9 ? (1 - c.t) / 0.1 : 1), 0.9 * (1 - k / 14) + 0.15, k === 0 ? 0.3 : 0);
      }
      if (c.t > 0.97 && !c.chegou) {
        c.chegou = true;
        if (c.g) c.g.ativ = Math.min(1.2, c.g.ativ + 0.25);
      }
    }

    // ---- desenho
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(P.buraco.p);
    uniformesCamera(P.buraco, B);
    gl.uniform1f(P.buraco.u.uAtiv, U.ativGeral);
    gl.uniform1f(P.buraco.u.uBase, U.baseUso);
    gl.uniform1f(P.buraco.u.uEsc, K);
    gl.bindVertexArray(vaoTela);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (nPoeira && U.gal.length) {
      gl.useProgram(P.poeira.p);
      uniformesCamera(P.poeira, B);
      const cat = (campo) => new Float32Array(Array.from({ length: MAX_GAL }, (_, i) => U.gal[i]?.[campo] ?? [0, 0, 0]).flat());
      gl.uniform3fv(P.poeira.u.uCentro, cat('centro'));
      gl.uniform3fv(P.poeira.u.uEx, cat('ex'));
      gl.uniform3fv(P.poeira.u.uEy, cat('ey'));
      gl.uniform3fv(P.poeira.u.uEz, cat('ez'));
      gl.uniform1fv(P.poeira.u.uFase, new Float32Array(Array.from({ length: MAX_GAL }, (_, i) => U.gal[i]?.fase ?? 0)));
      gl.uniform1fv(P.poeira.u.uBrilho, new Float32Array(Array.from({ length: MAX_GAL }, (_, i) => U.gal[i]?.brilho ?? 0)));
      gl.uniform1fv(P.poeira.u.uRaio, new Float32Array(Array.from({ length: MAX_GAL }, (_, i) => U.gal[i]?.raio ?? 1)));
      gl.bindVertexArray(vaoPoeira);
      gl.drawArrays(gl.POINTS, 0, nPoeira);
    }

    if (L.length) {
      bufL = garantir(bufL, L.length);
      bufL.set(L);
      gl.useProgram(P.linha.p);
      uniformesCamera(P.linha, B);
      gl.bindVertexArray(dLinha.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, dLinha.buf);
      gl.bufferData(gl.ARRAY_BUFFER, bufL.subarray(0, L.length), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, L.length / 10);
    }
    if (E.length) {
      bufE = garantir(bufE, E.length);
      bufE.set(E);
      gl.useProgram(P.estrela.p);
      uniformesCamera(P.estrela, B);
      gl.bindVertexArray(dEstrela.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, dEstrela.buf);
      gl.bufferData(gl.ARRAY_BUFFER, bufE.subarray(0, E.length), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, E.length / 9);
    }

    rotulos(B, pos, pertoDe, agora);
    U.raf = requestAnimationFrame(quadro);
  };

  // ------------------------------------------------------------------ nomes por cima (HTML)

  const els = new Map();
  const rotulos = (B, pos, pertoDe, agora) => {
    const vistos = new Set();
    const por = (chave, classe, texto, x, y, alfa, extra = '') => {
      let el = els.get(chave);
      if (!el) {
        el = document.createElement('span');
        camada.appendChild(el);
        els.set(chave, el);
      }
      const html = `${texto}${extra}`;
      if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
      }
      if (el.className !== classe) el.className = classe;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.opacity = alfa.toFixed(2);
      vistos.add(chave);
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    // buraco negro
    const sb = paraTela([0, 0, 0], B);
    if (sb) {
      const raioTela = ((15 * K) / (TAN * sb.z)) * U.tamanho[1] * 0.5;
      U.raioBuraco = ((SOMBRA * 1.3) / (TAN * sb.z)) * U.tamanho[1] * 0.5;
      U.telaBuraco = sb;
      const a = 1 - entre(260, 900, raioTela);
      if (a > 0.02) por('§base', `gx-nome base${U.baseUso > 0.1 ? ' ativo' : ''}`, 'Conhecimento base', sb.x, sb.y + Math.max(30, raioTela * 0.42), a, `<small>${U.base.length} ${U.base.length === 1 ? 'nota' : 'notas'}${U.baseUso > 0.1 ? ' · em uso' : ''}</small>`);
    }
    // galáxias
    U.telaGal = [];
    for (const g of U.gal) {
      const s = paraTela(g.centro, B);
      if (!s) continue;
      const rt = (g.raio / (TAN * s.z)) * U.tamanho[1] * 0.5;
      U.telaGal.push({ g, x: s.x, y: s.y, r: rt });
      const perto = pertoDe.get(g.i);
      const a = (1 - perto * 0.7) * (U.foco && U.foco !== g.chave ? 0.35 : 1);
      if (s.x < -200 || s.x > U.tamanho[0] + 200 || s.y < -100 || s.y > U.tamanho[1] + 100) continue;
      const estado = g.ativ > 0.3 ? ' · trabalhando' : g.forma < 0.35 ? ' · se formando' : '';
      const nc = g.notas.filter((x) => (x.camada ?? 'conhecimento') === 'conhecimento').length;
      por(`§g${g.chave}`, `gx-nome${g.ativ > 0.3 ? ' ativo' : ''}`, esc(g.titulo), s.x, s.y + Math.min(140, rt * 0.75) + 12, a, `<small>${nc} ${nc === 1 ? 'conhecimento' : 'conhecimentos'}${estado}</small>`);
    }
    // notas: as em uso sempre; as outras quando você está perto da galáxia delas
    const cand = [];
    for (const n of U.notas.values()) {
      const uso = usoDe(n.id, agora);
      const perto = n.g >= 0 ? pertoDe.get(n.g) : entre(150, 70, len(B.e));
      const foco = n.id === U.sel || n.id === U.hover;
      if (!((uso > 0.15 && perto > 0.22) || perto > 0.45 || foco)) continue;
      const s = paraTela(pos.get(n.id), B);
      if (!s || s.x < 0 || s.x > U.tamanho[0] || s.y < 0 || s.y > U.tamanho[1]) continue;
      cand.push({ n, s, peso: (foco ? 10 : 0) + uso * 5 + perto - s.z * 0.001, uso, perto, foco });
    }
    cand.sort((a, b) => b.peso - a.peso);
    for (const c of cand.slice(0, 16)) {
      const t = c.n.titulo.length > 34 ? `${c.n.titulo.slice(0, 33)}…` : c.n.titulo;
      por(`§n${c.n.id}`, `gx-nota${c.uso > 0.15 ? ' uso' : ''}${c.foco ? ' foco' : ''}`, esc(t), c.s.x + 10, c.s.y - 8, Math.max(c.uso > 0.15 ? Math.min(1, (c.perto - 0.22) * 4) : 0, Math.min(1, (c.perto - 0.4) * 2.5), c.foco ? 1 : 0));
    }
    for (const [k, el] of els) {
      if (!vistos.has(k)) {
        el.remove();
        els.delete(k);
      }
    }
  };

  // ------------------------------------------------------------------ interação

  const pegar = (x, y) => {
    const B = base();
    let melhor = null;
    let dist = 14;
    for (const p of U.proj) {
      const s = paraTela(p.p, B);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < dist) {
        dist = d;
        melhor = p;
      }
    }
    if (melhor) return melhor;
    for (const t of U.telaGal ?? []) if (Math.hypot(t.x - x, t.y - y) < Math.max(18, t.r * 0.55)) return { tipo: 'galaxia', g: t.g };
    if (U.telaBuraco && Math.hypot(U.telaBuraco.x - x, U.telaBuraco.y - y) < Math.max(20, U.raioBuraco)) return { tipo: 'base' };
    return null;
  };
  const ponto = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const baixo = (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const [x, y] = ponto(ev);
    U.arrasto = { x, y, x0: x, y0: y, mover: ev.button === 2 || ev.shiftKey, moveu: false };
    U.voo = null;
    U.ocioso = -6;
  };
  const mover = (ev) => {
    const [x, y] = ponto(ev);
    const a = U.arrasto;
    if (a) {
      const dx = x - a.x;
      const dy = y - a.y;
      a.x = x;
      a.y = y;
      if (Math.hypot(x - a.x0, y - a.y0) > 3) a.moveu = true;
      if (a.mover) {
        const B = base();
        const k = (U.cam.dist * TAN * 2) / U.tamanho[1];
        U.cam.alvo = add(U.cam.alvo, add(mul(B.d, -dx * k), mul(B.c, dy * k)));
      } else {
        U.cam.yaw -= dx * 0.005;
        U.cam.pitch = Math.max(-1.4, Math.min(1.4, U.cam.pitch + dy * 0.004));
      }
      canvas.style.cursor = 'grabbing';
      return;
    }
    const p = pegar(x, y);
    const id = p?.tipo === 'nota' ? p.id : null;
    canvas.style.cursor = p ? 'pointer' : 'grab';
    if (id !== U.hover) U.hover = id;
    op.aoPassar?.(p ? { ...p, x, y, base: p.tipo === 'base' || (p.tipo === 'nota' && p.g < 0), titulo: p.tipo === 'nota' ? p.titulo : p.tipo === 'galaxia' ? `${p.g.titulo} · ${p.g.notas.length} ${p.g.notas.length === 1 ? 'nota' : 'notas'}` : 'O centro do cérebro' } : null);
  };
  const cima = (ev) => {
    const a = U.arrasto;
    U.arrasto = null;
    canvas.style.cursor = 'grab';
    if (!a || a.moveu) return;
    const [x, y] = ponto(ev);
    const p = pegar(x, y);
    if (!p) return op.aoClicar?.(null);
    if (p.tipo === 'nota') return op.aoClicar?.(p.id);
    if (p.tipo === 'galaxia') return op.aoClicarEquipe?.(p.g.chave);
    if (p.tipo === 'base') {
      voar([0, 0, 0], 26 * K, norm([Math.sin(U.cam.yaw), 0.2, Math.cos(U.cam.yaw)]));
      return op.aoClicarBase?.();
    }
  };
  // Duplo clique: entra (na galáxia, perto da nota, ou no buraco).
  const duplo = (ev) => {
    const [x, y] = ponto(ev);
    const p = pegar(x, y);
    if (p?.tipo === 'galaxia') return voarGalaxia(p.g, true);
    if (p?.tipo === 'nota') {
      const g = U.gal[p.g];
      return voar([...p.p], g ? g.raio * 0.6 : 8);
    }
    if (p?.tipo === 'base') return voar([0, 0, 0], 7 * K, norm([Math.sin(U.cam.yaw), 0.1, Math.cos(U.cam.yaw)]));
    // no vazio: aproxima o ponto
    U.cam.dist = Math.max(4, U.cam.dist * 0.6);
  };
  const roda = (ev) => {
    ev.preventDefault();
    U.voo = null;
    U.ocioso = -6;
    const fator = Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0012));
    const nova = Math.max(2.2, Math.min(600, U.cam.dist * fator));
    // aproxima na direção do cursor (dá para "entrar" no que está apontando)
    const [x, y] = ponto(ev);
    const B = base();
    const nx = (x / U.tamanho[0]) * 2 - 1;
    const ny = 1 - (y / U.tamanho[1]) * 2;
    const dir = norm(add(B.f, add(mul(B.d, nx * TAN * (U.tamanho[0] / U.tamanho[1])), mul(B.c, ny * TAN))));
    // o ponto sob o cursor (na profundidade do alvo) fica parado: aproxima de onde você aponta
    const sob = add(B.e, mul(dir, U.cam.dist / Math.max(0.2, dot(dir, B.f))));
    U.cam.alvo = add(U.cam.alvo, mul(sub(sob, U.cam.alvo), 1 - nova / U.cam.dist));
    U.cam.dist = nova;
  };
  const tecla = (ev) => {
    if (ev.target.closest?.('input,textarea,select')) return;
    if (ev.key === 'Escape') visaoGeral();
    else if (ev.key === '+' || ev.key === '=') U.cam.dist = Math.max(2.2, U.cam.dist * 0.8);
    else if (ev.key === '-') U.cam.dist = Math.min(600, U.cam.dist * 1.25);
  };
  canvas.addEventListener('pointerdown', baixo);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', cima);
  canvas.addEventListener('pointercancel', () => (U.arrasto = null));
  canvas.addEventListener('pointerleave', () => {
    U.hover = null;
    op.aoPassar?.(null);
  });
  canvas.addEventListener('dblclick', duplo);
  canvas.addEventListener('wheel', roda, { passive: false });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('keydown', tecla);
  canvas.style.cursor = 'grab';

  medir();
  U.raf = requestAnimationFrame(quadro);

  // Para onde vai um cometa: a galáxia da equipe, ou o buraco (você, gestor sem galáxia, IAs).
  const ancora = (chave) => {
    const g = chave != null ? U.porChave.get(chave) : null;
    return g ? { p: [...g.centro], g } : { p: [0, 0, 0], g: null };
  };

  return {
    dados,
    atividade: (mapa) => (U.nivel = new Map(mapa)),
    usar: (ids) => {
      const t = performance.now();
      for (const id of ids) if (U.notas.has(id)) U.uso.set(id, t);
    },
    emUso: () => [...U.uso.keys()].filter((id) => usoDe(id, performance.now()) > 0.15),
    cometa: (de, para, cor) => {
      if (calmo) return;
      const a = ancora(de);
      const b = ancora(para);
      if (a.g && a.g === b.g) return void (a.g.ativ = Math.min(1.2, a.g.ativ + 0.2));
      const meio = len(sub(a.p, b.p));
      U.cometas.push({ de: a.p, para: b.p, alto: [0, meio * 0.25 + 6, 0], cor: rgb(cor || '#e6deff'), t: 0, dur: 1.6 + meio / 120, g: b.g });
      if (U.cometas.length > 30) U.cometas.shift();
    },
    foco: (chave, voa = true) => {
      U.foco = chave;
      const g = chave ? U.porChave.get(chave) : null;
      if (g && voa) voarGalaxia(g);
    },
    selecionar: (id) => {
      U.sel = id;
    },
    irPara: (id) => {
      const n = U.notas.get(id);
      if (!n) return;
      const g = n.g >= 0 ? U.gal[n.g] : null;
      const p = posNota(n, U.gal.map((x) => x.fase));
      voar(p, g ? g.raio * 0.9 : 10);
    },
    busca: (t) => (U.busca = t || ''),
    visaoGeral,
    aproximar: (k) => {
      U.voo = null;
      U.cam.dist = Math.max(2.2, Math.min(600, U.cam.dist * k));
    },
    destruir: () => {
      U.vivo = false;
      cancelAnimationFrame(U.raf);
      window.removeEventListener('keydown', tecla);
      canvas.remove();
      camada.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
};
