import React, {useState,useEffect} from 'react';
import {render, Text, Box} from 'ink';
import Spinner from 'ink-spinner';

const App=()=>{
  const [loading,setLoading] =useState(true);
  const [progress,setProgress]=useState(0);

  useEffect(()=>{
    // simulating loading 
    const interval = setInterval(()=>{
      setProgress(prev=>{
        if(prev>=100){
          setLoading(false);
          clearInterval(interval);
          return 100;
        }
        return prev+10;
      });
    }, 500);
    return ()=>clearInterval(interval);
  },[]);

  return (
  <Box flexDirection="column" padding={1}>
    <Text bold>Loading Spinner Demo</Text>
      {loading?(
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text colour="cyan">
            <Spinner type="dots"/> Loading ..
          </Text>
        </Box>

        {/* Progress bar*/}
        <Box marginTop={1}>
          <Text> {/*The  █ is unicode and is done by u2588 in insert mode click ctrl+v and type u2588 and for ░ is u2591*/}
            [{'█'.repeat(progress/10)}{'░'.repeat(10-progress/10)}]
          </Text>
        </Box>
      </Box>
      ):(
      <Box marginTop={1} backgroundColor="green" borderStyle="round" padding={1}>
            {/* for check mark the unicode is u2713*/}
        <Text colour="white" bold>✓ Loading Completed</Text>
      </Box>
      )}
  </Box>
  );
};

render(<App></App>);
