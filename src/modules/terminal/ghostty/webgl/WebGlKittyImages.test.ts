import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  TeraxGhosttyKittyImage,
  TeraxGhosttyKittyPlacement,
} from "@terax/ghostty-core/adapted";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import { WebGlCellRenderer } from "./WebGlCellRenderer";
import {
  clipPlacement,
  placementLayer,
  WebGlKittyImages,
} from "./WebGlKittyImages";

afterEach(() => vi.unstubAllGlobals());

const image = (
  id: number,
  generation: number,
  format: 1 | 2 | 3 | 4,
  data: Uint8Array,
  width = 2,
  height = 2,
): TeraxGhosttyKittyImage => ({ id, generation, width, height, format, data });

const placement = (
  picture: TeraxGhosttyKittyImage,
  over: Partial<TeraxGhosttyKittyPlacement> = {},
): TeraxGhosttyKittyPlacement => ({
  image: picture,
  x: 0,
  y: 0,
  z: 0,
  width: 8,
  height: 8,
  sourceX: 0,
  sourceY: 0,
  sourceWidth: picture.width,
  sourceHeight: picture.height,
  ...over,
});

describe("Kitty placement geometry", () => {
  it("puts negative z under text and only a strictly lower z under coloured cells", () => {
    expect(placementLayer(0)).toBe("above-text");
    expect(placementLayer(3)).toBe("above-text");
    expect(placementLayer(-1)).toBe("below-text");
    expect(placementLayer(-1_073_741_823)).toBe("below-text");
    expect(placementLayer(-1_073_741_824)).toBe("below-text");
    expect(placementLayer(-1_073_741_825)).toBe("below-cells");
  });

  it("clips a placement that starts above the viewport and keeps the matching source rows", () => {
    const clipped = clipPlacement(
      placement(image(1, 1, 4, new Uint8Array(16), 4, 4), {
        x: -4,
        y: -8,
        width: 16,
        height: 16,
        sourceX: 1,
        sourceY: 0,
        sourceWidth: 2,
        sourceHeight: 4,
      }),
      10,
      12,
    );
    expect(clipped).toMatchObject({
      x: 0,
      y: 0,
      width: 10,
      height: 8,
      sourceX: 1.5,
      sourceY: 2,
      sourceWidth: 1.25,
      sourceHeight: 2,
    });
  });

  it("drops a placement that lies completely outside the grid", () => {
    expect(
      clipPlacement(
        placement(image(1, 1, 4, new Uint8Array(16)), {
          x: 20,
          y: 0,
          width: 4,
          height: 4,
        }),
        10,
        10,
      ),
    ).toBeNull();
  });
});

describe("WebGlKittyImages", () => {
  it("allocates nothing until an image appears, uploads a generation once, and drops hidden images", () => {
    const gl = recordingContext();
    const images = new WebGlKittyImages(gl);
    const gray = image(7, 1, 1, Uint8Array.of(1, 2, 3, 4));
    const rgba = image(
      8,
      3,
      4,
      Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4),
    );

    expect(images.sync([], 32, 32)).toBe(false);
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(gl.createProgram).not.toHaveBeenCalled();
    expect(images.stats()).toMatchObject({ images: 0, gpuBytes: 0, cpuBytes: 0 });

    expect(
      images.sync(
        [placement(gray, { z: -1 }), placement(rgba, { z: 1, x: 8 })],
        32,
        32,
      ),
    ).toBe(true);
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    const grayUpload = uploadedPixels(gl, 0);
    expect([...grayUpload]).toEqual([
      1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255,
    ]);
    const rgbaUpload = uploadedPixels(gl, 1);
    expect([...rgbaUpload]).toEqual([...rgba.data]);
    gray.data.fill(0);

    gl.texImage2D.mockClear();
    expect(
      images.sync(
        [
          placement(gray, { z: -1 }),
          placement(gray, { z: -1, x: 16 }),
          placement(rgba, { z: 1, x: 8 }),
        ],
        32,
        32,
      ),
    ).toBe(true);
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(images.stats().images).toBe(2);

    images.draw("below-text", 32, 32);
    images.draw("above-text", 32, 32);
    expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(2);
    const uploads = gl.bufferData.mock.calls;
    const below = uploads[uploads.length - 2]?.[1] as Float32Array;
    expect([...below.subarray(0, 8)]).toEqual([0, 0, 8, 8, 0, 0, 1, 1]);
    expect([...below.subarray(8, 16)]).toEqual([16, 0, 8, 8, 0, 0, 1, 1]);

    const other = image(9, 1, 1, Uint8Array.of(5, 6, 7, 8));
    gl.drawElementsInstanced.mockClear();
    gl.bufferData.mockClear();
    recorded(gl, "bindTexture").mockClear();
    expect(
      images.sync(
        [
          placement(gray, { z: -3, x: 0 }),
          placement(other, { z: -2, x: 8 }),
          placement(gray, { z: -1, x: 16 }),
        ],
        32,
        32,
      ),
    ).toBe(true);
    images.draw("below-text", 32, 32);
    expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(3);
    const bound = recorded(gl, "bindTexture").mock.calls.map((call) => call[1]);
    expect(bound[0]).toBe(bound[2]);
    expect(bound[0]).not.toBe(bound[1]);
    const firstRun = gl.bufferData.mock.calls[0][1] as Float32Array;
    const middleRun = gl.bufferData.mock.calls[1][1] as Float32Array;
    const lastRun = gl.bufferData.mock.calls[2][1] as Float32Array;
    expect(firstRun[0]).toBe(0);
    expect(middleRun[0]).toBe(8);
    expect(lastRun[0]).toBe(16);
    gl.deleteTexture.mockClear();

    expect(images.sync([placement(rgba, { z: 1, x: 8 })], 32, 32)).toBe(true);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(images.stats()).toMatchObject({ images: 1, placements: 1 });

    images.reset();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(images.stats()).toMatchObject({
      images: 0,
      placements: 0,
      gpuBytes: 0,
      cpuBytes: 0,
    });
    expect(images.sync([], 32, 32)).toBe(false);
    expect(gl.createProgram).toHaveBeenCalledOnce();
  });

  it("reuploads when the same image id gets a new generation and ignores an unchanged frame", () => {
    const gl = recordingContext();
    const images = new WebGlKittyImages(gl);
    const first = image(
      4,
      1,
      3,
      Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    );
    images.sync([placement(first)], 16, 16);
    const replaced = image(
      4,
      2,
      3,
      Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2),
    );
    expect(images.sync([placement(replaced)], 16, 16)).toBe(true);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(gl.deleteTexture).toHaveBeenCalledOnce();
    expect([...uploadedPixels(gl, 1)]).toEqual([
      9, 8, 7, 255, 6, 5, 4, 255, 3, 2, 1, 255, 0, 1, 2, 255,
    ]);
    gl.texImage2D.mockClear();
    expect(images.sync([placement(replaced)], 16, 16)).toBe(false);
    expect(gl.texImage2D).not.toHaveBeenCalled();
  });
});

describe("WebGlCellRenderer Kitty placements", () => {
  it("draws images around text and clears them when they hide, reset, lose context, or dispose", () => {
    const gl = recordingContext();
    stubCanvas(gl);
    const renderer = new WebGlCellRenderer();
    const picture = image(
      1,
      1,
      4,
      Uint8Array.of(
        255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 64, 255, 255, 255, 255,
      ),
    );
    let placements: TeraxGhosttyKittyPlacement[] = [
      placement(picture, {
        z: -1_073_741_824,
        x: -2,
        y: -2,
        width: 6,
        height: 6,
      }),
      placement(picture, { z: -2, x: 4, y: 4 }),
      placement(picture, { z: 0, x: 100, y: 4 }),
    ];
    const model = modelWith(() => placements);
    renderer.configure(profile(), () => {}, () => {});
    gl.createTexture.mockClear();
    gl.texImage2D.mockClear();
    renderer.resize(2, 1);
    expect(gl.createTexture).not.toHaveBeenCalled();

    const frame = frameFor(model);
    expect(renderer.render(frame)).toBe(true);
    expect(gl.texImage2D).toHaveBeenCalledOnce();
    const draws = gl.drawElementsInstanced.mock.invocationCallOrder;
    expect(draws).toHaveLength(2);
    expect(gl.scissor).toHaveBeenCalledWith(0, 0, 16, 16);
    expect(draws[0]).toBeLessThan(draws[1]);
    const withImages = renderer.diagnostics().gpuBufferBytes;
    expect(withImages).toBeGreaterThan(0);

    gl.texImage2D.mockClear();
    gl.drawElementsInstanced.mockClear();
    expect(renderer.render(frame)).toBe(false);
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();

    placements = [];
    expect(renderer.render(frame)).toBe(true);
    expect(gl.deleteTexture).toHaveBeenCalled();
    expect(renderer.diagnostics().gpuBufferBytes).toBeLessThan(withImages);

    placements = [placement(picture, { z: 1 })];
    renderer.render(frame);
    const texturesBeforeReset = gl.deleteTexture.mock.calls.length;
    const programsBeforeReset = gl.deleteProgram.mock.calls.length;
    renderer.resetModel();
    expect(gl.deleteTexture.mock.calls.length).toBeGreaterThan(texturesBeforeReset);
    expect(gl.deleteProgram.mock.calls.length).toBeGreaterThan(programsBeforeReset);

    placements = [placement(picture, { z: 1, x: 1 })];
    renderer.render(frame);
    const texturesBeforeLoss = gl.deleteTexture.mock.calls.length;
    const programsBeforeLoss = gl.deleteProgram.mock.calls.length;
    renderer.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(gl.deleteTexture.mock.calls.length).toBe(texturesBeforeLoss);
    expect(gl.deleteProgram.mock.calls.length).toBe(programsBeforeLoss);
    expect(renderer.diagnostics().gpuBufferBytes).toBeLessThan(withImages);

    renderer.canvas.dispatchEvent(new Event("webglcontextrestored"));
    gl.texImage2D.mockClear();
    expect(renderer.render(frame)).toBe(true);
    expect(gl.texImage2D).toHaveBeenCalledOnce();

    renderer.dispose();
    expect(renderer.diagnostics().gpuBufferBytes).toBe(0);
  });
});

function profile() {
  return {
    metrics: {
      scale: 1,
      deviceCellWidth: 8,
      deviceCellHeight: 16,
      deviceBaseline: 12,
      cellWidth: 8,
      cellHeight: 16,
      baseline: 12,
      font: {
        family: "monospace",
        size: 14,
        weight: "400",
        lineHeight: 1.2,
        letterSpacing: 0,
      },
    },
    theme: {
      background: [0, 0, 0] as [number, number, number],
      foreground: [255, 255, 255] as [number, number, number],
      cursor: [255, 255, 255] as [number, number, number],
      cursorText: [0, 0, 0] as [number, number, number],
      selection: { color: [50, 50, 50] as [number, number, number], alpha: 0.5 },
      palette: [],
    },
    scale: 1,
    contrast: { enhancedContrast: 0, alphaCorrection: 0 },
  };
}

function modelWith(
  placements: () => readonly TeraxGhosttyKittyPlacement[],
): GhosttyTerminalModelApi {
  return {
    cols: 2,
    rows: 1,
    cursor: () => ({
      x: 0,
      y: 0,
      visible: false,
      blinking: false,
      style: "block",
    }),
    viewportOriginLine: () => 0,
    kittyPlacements: placements,
    renderCells: () => ({
      length: 2,
      width: () => 1,
      flags: () => 0,
      codepoint: () => 0,
      backgroundPacked: () => 0,
      foregroundPacked: () => 0xffffff,
      underlineColorPacked: () => 0,
      underlineStyle: () => 0,
      overline: () => false,
      graphemeLength: () => 0,
    }),
  } as unknown as GhosttyTerminalModelApi;
}

function frameFor(model: GhosttyTerminalModelApi) {
  return {
    model,
    damage: { kind: "none" as const },
    cursorVisible: false,
    textBlinkVisible: true,
    selection: null,
    searchMatchAt: () => 0 as const,
  };
}

function uploadedPixels(gl: RecordedGl, call: number): Uint8Array {
  const pixels = gl.texImage2D.mock.calls[call]?.[8];
  if (!(pixels instanceof Uint8Array)) {
    throw new Error("Kitty upload did not receive RGBA pixels");
  }
  return pixels;
}

function stubCanvas(gl: WebGL2RenderingContext): void {
  vi.stubGlobal("document", {
    createElement: () =>
      Object.assign(new EventTarget(), {
        width: 1,
        height: 1,
        style: {},
        className: "",
        setAttribute() {},
        remove() {},
        getContext: (kind: string) => {
          if (kind === "webgl2") return gl;
          if (kind === "2d") return rasterContext();
          return null;
        },
      }),
  });
}

type RecordedCall = unknown[];

type RecordedMethod = Mock & { mock: { calls: RecordedCall[] } };

type RecordedGl = WebGL2RenderingContext & {
  texImage2D: RecordedMethod;
  createTexture: RecordedMethod;
  deleteTexture: RecordedMethod;
  createProgram: RecordedMethod;
  deleteProgram: RecordedMethod;
  drawElementsInstanced: RecordedMethod;
  bufferData: RecordedMethod;
  scissor: RecordedMethod;
  useProgram: RecordedMethod;
};

function recorded(gl: RecordedGl, name: string): RecordedMethod {
  return (gl as unknown as Record<string, RecordedMethod>)[name];
}

function rasterContext(): CanvasRenderingContext2D {
  return {
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText() {},
    measureText: () => ({
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
    }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "white",
  } as unknown as CanvasRenderingContext2D;
}

function recordingContext(): RecordedGl {
  const methods = new Map<string, Mock>();
  return new Proxy(
    {},
    {
      get: (_, key: string) => {
        if (key === "canvas") return { width: 16, height: 16 };
        if (/^[A-Z0-9_]+$/.test(key)) return 1;
        let method = methods.get(key);
        if (!method) {
          method = vi.fn((...args: unknown[]) => {
            if (key === "getExtension") return null;
            if (
              key === "createTexture" ||
              key === "createBuffer" ||
              key === "createVertexArray"
            ) {
              return { kind: key, id: (method?.mock.calls.length ?? 0) + 1 };
            }
            if (key === "createProgram" || key === "createShader") return { kind: key };
            if (key === "getProgramParameter" || key === "getShaderParameter") return true;
            if (key === "getUniformLocation") return { name: args[1] };
            if (key === "isEnabled") return false;
            return undefined;
          });
          methods.set(key, method);
        }
        return method;
      },
    },
  ) as RecordedGl;
}
