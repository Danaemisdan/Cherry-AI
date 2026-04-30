const LLMClient = {
  port: null,
  isConnecting: false,
  messageQueue: [],
  callbacks: new Map(),
  messageIdCount: 0,

  async connect() {
    if (this.port) return;
    if (this.isConnecting) {
      return new Promise(resolve => {
        const check = setInterval(() => {
          if (this.port) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    this.isConnecting = true;
    console.log("Connecting to Cherry Native LLM Host (Cherry AI Engine)...");
    
    try {
      this.port = chrome.runtime.connectNative('com.cherryai.llm');
      
      this.port.onMessage.addListener((msg) => {
        console.log("Received LLM Response:", msg);
        if (msg.id && this.callbacks.has(msg.id)) {
          this.callbacks.get(msg.id)(msg.text || msg.error);
          this.callbacks.delete(msg.id);
        }
      });
      
      this.port.onDisconnect.addListener(() => {
        console.log("LLM Host disconnected. Error:", chrome.runtime.lastError);
        this.port = null;
        // Reject all pending promises if host dies
        for (const [, resolve] of this.callbacks.entries()) {
           resolve({ error: "Host Disconnected" });
        }
        this.callbacks.clear();
      });
      
    } catch (e) {
      console.error("Failed to connect native host:", e);
    } finally {
      this.isConnecting = false;
    }
  },

  async generate(prompt, maxTokens = 150, temperature = 0.75) {
    if (!this.port) await this.connect();
    
    // Attempt local native LLM first
    if (this.port) {
      try {
        const response = await new Promise((resolve) => {
          const msgId = ++this.messageIdCount;
          this.callbacks.set(msgId, resolve);
          this.port.postMessage({
            id: msgId,
            prompt: prompt,
            max_tokens: maxTokens,
            temperature: temperature,
            stop_words: ["DM:", "</s>", "<|user|>", "<|assistant|>", "<start_of_turn>", "<end_of_turn>", "Constraints:"]
          });
          
          // Timeout local LLM after 15 seconds
          setTimeout(() => {
            if (this.callbacks.has(msgId)) {
              this.callbacks.delete(msgId);
              resolve({ error: "Timeout" });
            }
          }, 15000);
        });

        if (response && !response.error && typeof response === 'string') {
           return response;
        }
      } catch {
        console.log("Local LLM request failed.");
      }
    }

    throw new Error('Local GGUF host unavailable. Install the native host and bundled model to use Cherry AI.');
  }
};

export default LLMClient;
