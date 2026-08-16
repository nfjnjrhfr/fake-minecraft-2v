// Thin WebGL2 helpers: program compilation, buffer objects, textures.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('這個瀏覽器不支援 WebGL2');
  return gl;
}

export function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    throw new Error('Shader compile error: ' + log + '\n' + src);
  }
  return sh;
}

export function createProgram(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  const prog = { program: p, u: {}, a: {} };
  const nU = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) {
    const info = gl.getActiveUniform(p, i);
    prog.u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  const nA = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nA; i++) {
    const info = gl.getActiveAttrib(p, i);
    prog.a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return prog;
}

/** Interleaved vertex buffer + index buffer wrapped in a VAO. */
export class Mesh {
  constructor(gl, layout) {
    this.gl = gl;
    this.layout = layout;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    this.count = 0;
    this.stride = layout.reduce((s, a) => s + a.size, 0) * 4;
  }
  upload(vertices, indices) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    let offset = 0;
    for (const attr of this.layout) {
      if (attr.loc >= 0) {
        gl.enableVertexAttribArray(attr.loc);
        gl.vertexAttribPointer(attr.loc, attr.size, gl.FLOAT, false, this.stride, offset);
      }
      offset += attr.size * 4;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.count = indices.length;
    gl.bindVertexArray(null);
  }
  draw(mode) {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(mode === undefined ? gl.TRIANGLES : mode, this.count, gl.UNSIGNED_INT, 0);
  }
  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    this.count = 0;
  }
}

export function createTextureFromCanvas(gl, canvas, nearest = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
