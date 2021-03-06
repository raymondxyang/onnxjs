// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {Sum} from '../../../ops/sum';
import {Tensor} from '../../../tensor';
import {WebGLInferenceHandler} from '../inference-handler';
import {ProgramInfo} from '../program-info';
import {RunData} from '../program-manager';
import {WebGLOperator} from '../webgl-operator';
import {WebGLOperatorHelper} from '../webgl-operator-utils';

export class WebGLSum extends Sum implements WebGLOperator {
  run(inferenceHandler: WebGLInferenceHandler, inputs: Tensor[]): Tensor[] {
    return WebGLOperatorHelper.run(this, inferenceHandler, inputs);
  }
  createProgramInfo(handler: WebGLInferenceHandler, inputs: Tensor[]): ProgramInfo {
    const outputShape = inputs[0].dims.slice();
    const sumLine = inputs.map((v, i) => `texture2D(X${i},TexCoords)`).join(' + ');
    const inputUniforms = inputs.map((v, i) => `uniform sampler2D X${i};`);
    const shaderSource = `
      ${inputUniforms.join('\n')}
      void main() {
        vec4 result = ${sumLine};
        gl_FragColor = result;
      }`;
    return {
      hasMain: true,
      inputLayouts: inputs.map(t => handler.getOrCreateTextureLayout(t)),
      outputLayout: handler.createBasicTextureLayout(outputShape),
      shaderSource,
    };
  }
  createRunData(handler: WebGLInferenceHandler, programInfo: ProgramInfo, inputs: Tensor[]): RunData {
    const inputTDs = inputs.map((t, i) => handler.getOrCreate(t, programInfo.inputLayouts[i]));
    return {
      inputTextureDatas: inputTDs,
      outputTextureData: handler.createTextureDataFromLayout(programInfo.outputLayout, inputTDs[0].dataType),
      uniformData: {}
    };
  }
}
