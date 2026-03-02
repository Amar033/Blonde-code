import React, {useState,useEffect} from 'react';
import {render,Text,Box} from 'ink';
import Spinner from 'ink-spinner';

// simulate async agent 

async function* simulateAgent(){
  yield{type:'start',message:'Agent starting...'};
  await sleep(1000);

  yield{type:'planning', message:'Creating plan...'};
  await sleep(1500);

  yield {type:'acting',message:'Executing tool: read_file'};
  await sleep(2000);

  yield {type:'observing', message:'Tool Completed succesfully'};
  await sleep(1000);

  yield {type:'complete', message: 'Task finished!'};
}

function sleep(ms:number){
  return new Promise (resolve=> setTimeout(resolve,ms));
}

const App=()=>{
  const [events,setEvents]=useState<any[]>([]);
  const [currentState,setCurrentStatus]=useState('idle');
  const [isComplete,setIsComplete]=useState(false);

  useEffect(()=>{
    (async ()=>{
      for await (const event of simulateAgent()){
        setEvents(prev=>[...prev,event]);
        setCurrentStatus(event.type);

        if(event.type==='complete'){
          setIsComplete(true);
        }
      }
    })();
  },[]);

  const getStatusColor=(status:string)=>{
    const colors:Record<string,string>={
      start:'cyan',
      planning:'yellow',
      acting:'blue',
      observing:'magenta',
      complete:'green',
    };
    return colors[status] || 'white';
  };


  return (
  <Box flexDirection="column" padding={1}>
    <Text bold>Async agent simulation</Text>
      {/* Current Status */}
      <Box amrginTop={1} borderStyle="round" borderColor={getStatusColor(currentState)} padding={1}>
        {isComplete && (
        <Text color="green" bold>
          ✓ complete 
        </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" padding={1}>
        <Text bold>Event history</Text>
        {events.map((event,i)=>(
        <Box key={i} marginTop={i===0?0:0}>
          <Text color={getStatusColor(event.type)}>
            . {event.message} 
          </Text>
        </Box>
        ))}
      </Box>
  </Box>
  );
};


render(<App></App>);
