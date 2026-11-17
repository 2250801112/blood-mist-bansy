export function createSound() {
  let context, master;

  function prepare() {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);

    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let drift = 0;
    for (let i = 0; i < samples.length; i += 1) {
      drift = drift * 0.985 + (Math.random() - 0.5) * 0.035;
      samples[i] = drift * Math.sin(Math.PI * i / (samples.length - 1)) ** 2;
    }
    const wind = context.createBufferSource();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 290;
    wind.buffer = buffer;
    wind.loop = true;
    wind.connect(filter).connect(master);
    wind.start();
  }

  async function setEnabled(enabled) {
    if (enabled) {
      if (!context) prepare();
      await context.resume();
    } else if (context) {
      await context.suspend();
    }
  }

  function intro() {
    if (context?.state !== 'running') return;
    for (const delay of [0.18, 1.6]) {
      const start = context.currentTime + delay;
      for (const [frequency, volume] of [[94, 0.18], [201, 0.09], [308, 0.04]]) {
        const tone = context.createOscillator();
        const envelope = context.createGain();
        tone.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.001, start);
        envelope.gain.exponentialRampToValueAtTime(volume, start + 0.04);
        envelope.gain.exponentialRampToValueAtTime(0.001, start + 2.5);
        tone.connect(envelope).connect(master);
        tone.start(start);
        tone.stop(start + 2.5);
      }
    }
  }

  return { setEnabled, intro };
}
