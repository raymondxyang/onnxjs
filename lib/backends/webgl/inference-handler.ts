// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {InferenceHandler} from '../../backend';
import {Logger} from '../../instrument';
import {Tensor} from '../../tensor';
import {ShapeUtil} from '../../util';
import {WebGLBackend} from '../backend-webgl';

import {ProgramManager} from './program-manager';
import {WebGLSessionHandler} from './session-handler';
import {TextureData, TextureLayout} from './texture-data';
import {TextureHelper} from './texture-helper';
import {WidthHeightPrefs} from './texture-layout-strategy';
import {getPackedShape} from './utils';

/**
 * GlInferencContext is reponsible for mapping from Tensors to TextureData
 * and back
 * Throughout WebGL backend operations TextureData is used as the data carrier
 */
export class WebGLInferenceHandler implements InferenceHandler {
  textureHelper: TextureHelper;
  programManager: ProgramManager;
  private tensorToTexture: Map<Tensor, TextureData>;
  private textureToTensor: Map<TextureData, Tensor>;
  constructor(public backend: WebGLBackend, public session: WebGLSessionHandler) {
    this.textureHelper = session.textureHelper;
    this.programManager = session.programManager;
    this.tensorToTexture = new Map();
    this.textureToTensor = new Map();
  }
  protected lookupTextureData(tensor: Tensor): TextureData|undefined {
    const isInitializer = this.session.isInitializer(tensor);
    Logger.verbose('InferenceHandler', `tensor was an initializer; returning TextureData from session cache`);
    return isInitializer ? this.session.getTextureData(tensor) : this.tensorToTexture.get(tensor);
  }
  getOrCreate(tensor: Tensor, layout?: TextureLayout): TextureData {
    let td = this.lookupTextureData(tensor);
    if (!td) {
      Logger.verbose('InferenceHandler', `Creating new TextureData for dims: [${tensor.dims}]`);
      if (!layout) {
        layout = this.createBasicTextureLayout(tensor.dims.slice());
      }
      td = this.createTextureDataFromLayout(layout, tensor.type, tensor.numberData);
      this.setTextureData(tensor, td);
    } else {
      Logger.verbose('InferenceHandler', `Retrieving TextureData from cache: [${tensor.dims}]`);
    }
    return td;
  }
  getTextureData(tensor: Tensor): TextureData|undefined {
    return this.lookupTextureData(tensor);
  }
  setTextureData(tensor: Tensor, td: TextureData): void {
    if (this.session.isInitializer(tensor)) {
      this.session.setTextureData(tensor, td);
      return;
    }
    this.tensorToTexture.set(tensor, td);
    this.textureToTensor.set(td, tensor);
  }
  getTensor(td: TextureData): Tensor {
    let tensor: Tensor|undefined;
    tensor = this.textureToTensor.get(td);
    if (!tensor) {
      Logger.verbose('InferenceHandler', `Creating new Tensor from texture data: [${td.unpackedShape}]`);
      tensor = new Tensor(td.unpackedShape, td.dataType, (id: Tensor.Id) => {
        const values = this.textureHelper.readTexture(td, td.dataType, td.channels);
        return values;
      });
      this.setTextureData(tensor, td);
    } else {
      Logger.verbose('InferenceHandler', `Retrieving Tensor from cache for:[${td.unpackedShape}]`);
    }
    return tensor;
  }
  getOrCreateTextureLayout(tensor: Tensor, channels = 1, unpackedShape?: number[]): TextureLayout {
    const td = this.getTextureData(tensor);
    if (td) {
      return td;
    }
    return this.createBasicTextureLayout(
        channels === 1 ? tensor.dims.slice() : getPackedShape(tensor.dims.slice()), channels, unpackedShape);
  }
  dispose(): void {
    this.textureHelper.clearActiveTextures();
    this.tensorToTexture.forEach(td => this.textureHelper.releaseTexture(td.texture));
    this.tensorToTexture = new Map();
    this.textureToTensor = new Map();
  }
  createTextureData(
      dataType: Tensor.DataType, shape: number[], strides?: number[], data?: Tensor.NumberType, channels?: number,
      width?: number, height?: number): TextureData {
    Logger.verbose('InferenceHandler', `Creating TextureData: shape:[${shape}], channels:${channels ? channels : 1}`);
    const td = this.textureHelper.createTexture(dataType, shape, strides, data, channels, width, height);
    return td;
  }
  createTextureDataFromLayout(layout: TextureLayout, dataType: Tensor.DataType, data?: Tensor.NumberType): TextureData {
    Logger.verbose('InferenceHandler', `Creating TextureData: layout:[${JSON.stringify(layout)}]`);
    const td = this.textureHelper.createTextureFromLayout(dataType, layout, data);
    return td;
  }
  createBasicTextureLayout(shape: number[], channels = 1, unpackedShape?: number[], prefs?: WidthHeightPrefs):
      TextureLayout {
    const [width, height] = this.session.layoutStrategy.computeTextureWH(shape, prefs);
    if (channels === 1) {
      unpackedShape = shape;
    } else if (!unpackedShape) {
      throw new Error('Unpacked shape is needed when using channels > 1');
    }
    return {
      width,
      height,
      channels: channels ? channels : 1,
      shape,
      strides: ShapeUtil.computeStrides(shape),
      unpackedShape
    };
  }
}
