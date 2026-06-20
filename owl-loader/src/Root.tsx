import React from 'react';
import { Composition } from 'remotion';
import { Owl } from './Owl';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OwlLoader"
      component={Owl}
      durationInFrames={48}
      fps={24}
      width={80}
      height={80}
      defaultProps={{}}
    />
  );
};
