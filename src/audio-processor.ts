declare var AudioWorkletProcessor: any;
declare var registerProcessor: any;

class AudioProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const inputData = input[0];
            // Simple Noise Gate
            let hasActivity = false;
            const threshold = 0.01;
            for (let i = 0; i < inputData.length; i++) {
                if (Math.abs(inputData[i]) > threshold) {
                    hasActivity = true;
                    break;
                }
            }
            if (hasActivity) {
                this.port.postMessage(inputData);
            }
        }
        return true;
    }
}
registerProcessor('audio-processor', AudioProcessor);
