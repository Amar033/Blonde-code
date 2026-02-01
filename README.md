# Blonde-code
A Proper AI developer tool taking inspiration from claude code and opencode made by myself without any ai tools to support me in this.
[01-02-2026]

### Why?
I am trying to build this project from scratch with the agent runtime and the almost all the components build by me so that i can understand first hand how an agentc system works. I did a simple ai dev tool in the past with the same name title [Blonde](https://github.com/cerekinorg/BlondE-cli-v1.0.0) , which also had a offline mode since some models could be ran using the cpu via llama.cpp but this was dependency hell, though that was developed in python and most important portiobns of it were vibecoded and caused errors in long run, hence i wanted to build a proper agent in v2, which was proper at first again but the TUI failed me (again the issue being vibe coding at that part), but v2 of blonde was downloadable and executable and it looked better, but had inherent flaws that couldnt be fixed because of misconceptions that i had while building it. 

So, From scratch i plan to have a proper plan and step by step create this project so that i can build this system and apply it as well in almost all developer use case, and i also plan to use some other methods for the local modal running in system and having atleast half the capabilty of the online models that we can call via apis.

Thank you for reading till now, from today i will start coding for this project!


Currently I iterated on plan and chose typescript as the base language even though I am not good at this.
Why not?, It will be fun. (I have no idea)
So all the process in the agent runtime is based on events  and also a lot of tooling and format issues may arise so, I THINK, typescript is a good choice? Correct me if i am wrong.

So currently planning the project and i have decided on the setup to be done on node, and MAYBE try bun in the future (I am currently just shouting buzzwords at this point)

The llm layer of the project will be built using already existing ai sdks but i plan to setup my own service layer for the llms so that i can switch between multiple providers and even with local models.

The project is setup as:

Blonde
|-scr 
  |-planner (llm portion)
  |-runtime (agent runtime)
  |-tools (mcp tools or any tools that the application may require)
  |-types (all ts definitions)
  |-ui (TUI portion)
|-main.ts (entry point)

I am unsure if i should start with the design of the tui for better understanding of the input and output or to be just focused on the backend for now.

