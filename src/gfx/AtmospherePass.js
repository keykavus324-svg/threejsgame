import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Depth-driven cinematics in a single fullscreen pass:
 *   • screen-space ambient occlusion (reconstructed normals, hemisphere kernel)
 *   • volumetric-ish sun shafts / god rays (radial occlusion march toward the sun)
 *   • depth-of-field bokeh approximation (used for ADS / scope / killcam)
 * Reads the composer's DepthTexture directly, so no extra scene re-render.
 */
const frag = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uRes;
uniform vec2 uSunPos;
uniform vec3 uSunColor;
uniform float uNear, uFar, uAO, uShafts, uDOF, uFocus, uFocusRange, uSunVisible, uTime;
uniform int uAOSamples, uRaySamples;
varying vec2 vUv;

vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, clamp(uv, vec2(0.001), vec2(0.999))).x;
  vec4 clip = vec4(uv*2.0-1.0, d*2.0-1.0, 1.0);
  vec4 v = uProjInv * clip;
  return v.xyz / max(v.w, 1e-5);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec3 hemisphere(int i, vec3 n, vec2 seed){
  float a = float(i)*2.399963 + hash(seed)*6.2831;
  float r = sqrt((float(i)+0.5)/12.0);
  vec3 h = vec3(cos(a)*r, sin(a)*r, sqrt(max(0.0,1.0-r*r)));
  vec3 t = normalize(cross(abs(n.y)<0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0), n));
  vec3 b = cross(n,t);
  return normalize(t*h.x + b*h.y + n*h.z);
}

void main(){
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float rawDepth = texture2D(tDepth, vUv).x;
  vec3 P = viewPos(vUv);
  float depth = -P.z;
  bool sky = rawDepth > 0.9995;

  // ---------------------------------------------------------------- AO
  if (uAO > 0.001 && !sky && depth < uFar*0.85){
    vec3 dx = dFdx(P), dy = dFdy(P);
    vec3 N = normalize(cross(dx,dy));
    if (dot(N,N) > 0.5) {
      float occ = 0.0;
      float radius = 1.5 + depth*0.012;
      for (int i=0;i<12;i++){
        if (i >= uAOSamples) break;
        vec3 dir = hemisphere(i, N, vUv*uRes*0.01);
        vec3 S = P + dir*radius;
        vec4 clip = uProj*vec4(S,1.0);
        vec2 suv = clip.xy/max(clip.w,1e-5)*0.5+0.5;
        if (suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) continue;
        float sd = -viewPos(suv).z;
        float rangeCheck = smoothstep(0.0,1.0, radius/max(0.001,abs(depth-sd)));
        occ += (sd < S.z + 0.035 ? 1.0 : 0.0)*rangeCheck;
      }
      float ao = 1.0 - (occ/float(uAOSamples))*uAO;
      col *= clamp(ao, 0.35, 1.0);
    }
  }

  // ---------------------------------------------------------------- sun shafts
  if (uShafts > 0.001 && uSunVisible > 0.01){
    vec2 delta = (uSunPos - vUv) / float(uRaySamples) * 0.86;
    vec2 uv = vUv;
    float illum = 1.0;
    float acc = 0.0;
    for (int i=0;i<24;i++){
      if (i >= uRaySamples) break;
      uv += delta;
      float d = texture2D(tDepth, clamp(uv, vec2(0.0), vec2(1.0))).x;
      acc += step(0.9994, d) * illum;
      illum *= 0.935;
    }
    float falloff = 1.0 - smoothstep(0.0, 1.15, length(vUv - uSunPos));
    col += uSunColor * (acc/float(uRaySamples)) * uShafts * falloff * uSunVisible;
  }

  // ---------------------------------------------------------------- depth of field
  if (uDOF > 0.001){
    float coc = clamp(abs(depth - uFocus)/max(1.0,uFocusRange), 0.0, 1.0);
    coc = pow(coc, 1.35) * uDOF;
    if (coc > 0.004){
      vec2 px = coc * 9.0 / uRes;
      vec3 blur = vec3(0.0);
      blur += texture2D(tDiffuse, vUv + vec2( 1.0, 0.0)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2(-1.0, 0.0)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2(0.0,  1.0)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2(0.0, -1.0)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2( 0.7, 0.7)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2(-0.7, 0.7)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2( 0.7,-0.7)*px).rgb;
      blur += texture2D(tDiffuse, vUv + vec2(-0.7,-0.7)*px).rgb;
      col = mix(col, blur*0.125, clamp(coc*2.4,0.0,0.92));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class AtmospherePass extends Pass {
  constructor(camera, width, height) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(width, height) },
      uSunPos: { value: new THREE.Vector2(.5, .5) },
      uSunColor: { value: new THREE.Color(1.0, .62, .3) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uAO: { value: .85 },
      uShafts: { value: .34 },
      uDOF: { value: 0 },
      uFocus: { value: 40 },
      uFocusRange: { value: 22 },
      uSunVisible: { value: 0 },
      uTime: { value: 0 },
      uAOSamples: { value: 10 },
      uRaySamples: { value: 20 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: frag,
      extensions: { derivatives: true },
      depthTest: false, depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this._sp = new THREE.Vector3();
    this._sv = new THREE.Vector4();
  }

  /** sunDir: normalized world-space direction from the scene toward the sun. */
  setSun(sunDir, camera, intensity = 1) {
    camera.updateMatrixWorld();
    const p = this._sp.copy(sunDir).multiplyScalar(500).applyMatrix4(camera.matrixWorldInverse);
    const behind = p.z > -camera.near;
    const v = this._sv.set(p.x, p.y, p.z, 1).applyMatrix4(camera.projectionMatrix);
    const invW = 1 / Math.max(Math.abs(v.w), 1e-5);
    const x = v.x * invW * .5 + .5, y = v.y * invW * .5 + .5;
    this.uniforms.uSunPos.value.set(x, y);
    const edge = Math.max(0, 1 - Math.max(Math.abs(x - .5), Math.abs(y - .5)) * 1.4);
    this.uniforms.uSunVisible.value = behind ? 0 : clamp01(edge * intensity);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture || null;
    if (!u.tDepth.value) { this.enabled = false; return; }
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  setSize(w, h) { this.uniforms.uRes.value.set(w, h); }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
