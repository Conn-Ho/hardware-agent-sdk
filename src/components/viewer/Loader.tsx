import Lottie from 'lottie-react';
import { useEffect, useRef, useState } from 'react';
import adamLoading from '@/assets/adam-loading.json';

type Props = {
  message?: string;
};

const Loader = ({ message }: Props) => {
  const dot2 = useRef<HTMLSpanElement>(null);
  const dot3 = useRef<HTMLSpanElement>(null);
  const loadingMessage = useRef<HTMLParagraphElement>(null);

  const [changingMessage, setChangingMessage] = useState(message);

  useEffect(() => {
    // CHANGE MESSAGE AFTER 2 SECONDS
    setTimeout(() => {
      if (loadingMessage.current && changingMessage !== 'Rendering') {
        loadingMessage.current.classList.add('opacity-0');
        setTimeout(() => {
          loadingMessage.current?.classList.remove('opacity-0');
          setChangingMessage('Rendering');
        }, 200);
      }
    }, 2000);

    // CHANGE TAB TITLE
    document.title = 'Loading model.';

    const titleInterval = setInterval(() => {
      if (document.title === 'Loading model.') {
        document.title = 'Loading model..';
      } else if (document.title === 'Loading model..') {
        document.title = 'Loading model...';
      } else {
        document.title = 'Loading model.';
      }
    }, 300);

    // ANIMATE LAST TWO DOTS WITH DELAYS AND INTERVALS
    const interval = setInterval(() => {
      dot2.current?.classList.toggle('opacity-0');
      setTimeout(() => {
        dot3.current?.classList.toggle('opacity-0');
      }, 300);
      setTimeout(() => {
        dot2.current?.classList.toggle('opacity-0');
        dot3.current?.classList.toggle('opacity-0');
      }, 600);
    }, 900);

    // Cleanup intervals on unmount
    return () => {
      clearInterval(titleInterval);
      clearInterval(interval);
      document.title = 'Hardware Agent';
    };
  }, [changingMessage]);

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative h-32 w-32">
        <Lottie
          animationData={adamLoading}
          loop={true}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {message && (
        <p
          ref={loadingMessage}
          className="mt-4 text-base text-adam-text-primary transition-opacity duration-200"
        >
          {changingMessage}
          <span>.</span>
          <span
            ref={dot2}
            className="opacity-0 transition-opacity duration-200"
          >
            .
          </span>
          <span
            ref={dot3}
            className="opacity-0 transition-opacity duration-200"
          >
            .
          </span>
        </p>
      )}
    </div>
  );
};

export default Loader;
