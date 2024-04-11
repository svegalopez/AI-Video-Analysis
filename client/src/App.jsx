import { useEffect, useState } from "react";
import { useMemo } from "react";
import MarkdownIt from "markdown-it";

const states = {
  1: "Video Upload",
  2: "Video Processing",
  3: "Ask me",
};

function App() {
  const [isProcessing, setIsProcessing] = useState(false); // Stores the key of the video being processed
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let intervalId;
    if (isProcessing) {
      intervalId = setInterval(() => {
        console.log("Polling for completion...", isProcessing);

        fetch(`/video/${isProcessing}`)
          .then((response) => {
            if (response.ok) {
              console.log("Setting isReady to", isProcessing);

              setIsReady(isProcessing);
              setIsProcessing(false);
            }
          })
          .catch((error) => {
            console.error("Error polling for completion:", error);
          });
      }, 3000);
    }

    return () => {
      clearInterval(intervalId);
    };
  }, [isProcessing]);

  const hideUploadWidget = useMemo(
    () => isProcessing || isReady,
    [isProcessing, isReady]
  );

  const title = useMemo(() => {
    if (isProcessing) {
      return states[2];
    } else if (isReady) {
      return states[3];
    } else {
      return states[1];
    }
  }, [isProcessing, isReady]);

  const hideSpinner = useMemo(() => !isProcessing, [isProcessing]);
  const hideForm = useMemo(() => !isReady, [isReady]);

  return (
    <div>
      <h1>{title}</h1>
      <VideoUpload
        hidden={hideUploadWidget}
        onUpload={(key) => setIsProcessing(key)}
      />
      <Spinner hidden={hideSpinner} />
      <Form hidden={hideForm} videoKey={isReady} />
    </div>
  );
}

export default App;

function VideoUpload({ hidden, onUpload }) {
  const [video, setVideo] = useState(null);

  // Function to handle video file selection
  const handleVideoChange = (event) => {
    setVideo(event.target.files[0]);
  };

  // Function to handle video upload (example to a server)
  const handleUpload = async () => {
    if (!video) {
      alert("Please select a video file first.");
      return;
    }

    const formData = new FormData();
    formData.append("video", video);

    // Example POST request to an API endpoint
    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        onUpload && onUpload(await response.text());
      } else {
        alert("Failed to upload video.");
      }
    } catch (error) {
      console.error("Error during upload:", error);
    }
  };

  return (
    <div style={{ display: hidden ? "none" : "block" }}>
      <input type="file" accept="video/*" onChange={handleVideoChange} />
      <button onClick={handleUpload}>Upload Video</button>
    </div>
  );
}

// on click the button, call a handler that will make a fetch request to POST /completions/:key, sending the question in the body
function Form({ hidden, videoKey }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");

  const handleQuestionChange = (event) => {
    setQuestion(event.target.value);
  };

  const handleSubmit = async () => {
    // show loader inside button
    // disable button
    setLoading(true);

    // empty answer
    setAnswer("");

    try {
      const response = await fetch(`/completions/${videoKey}`, {
        method: "POST",
        body: JSON.stringify({ question }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        // Handle successful response
        const answer = await response.text();
        console.log("Answer:", answer);
        setAnswer(answer);
      } else {
        // Handle error response
        console.error(await response.text());
      }
    } catch (error) {
      console.error("Error during fetch:", error);
    }

    // reset button
    setLoading(false);
  };

  return (
    <>
      <div className="ask-form" style={hidden ? { display: "none" } : null}>
        <textarea
          placeholder="Ask me anything about the video"
          value={question}
          onChange={handleQuestionChange}
        ></textarea>
        <button disabled={loading} onClick={handleSubmit}>
          {loading ? <Spinner scale={0.35} /> : "Submit"}
        </button>
      </div>
      {answer && (
        <div
          dangerouslySetInnerHTML={{
            __html: markdownToHTML(answer),
          }}
          className="answer-box"
        ></div>
      )}
    </>
  );
}

function Spinner({ hidden, scale }) {
  return (
    <div
      style={{
        display: hidden ? "none" : "block",
        transform: scale ? `scale(${scale})` : undefined,
      }}
      className="lds-roller"
    >
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
    </div>
  );
}

function markdownToHTML(markdown) {
  // Remove the following pattern 【whatever】from the string
  const quoteRegex = /【.*?】/g;
  markdown = markdown.replace(quoteRegex, "");

  // Render the markup to html
  const md = new MarkdownIt();
  return md.render(markdown);
}
