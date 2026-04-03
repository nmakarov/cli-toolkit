Software design principles

Going to write a list of principles how good software is built and why it is iterative process.


Main principles:
1. Developed system should do what it meant to be doing, with optimal performance and used resources
2. Code must be clean, consistent and easy to read/maintain (code maintainability)
3. Code should be testable, fully
4. Code should be understood by helper AI tools
5. Code should be fully run on the devs machines
6. Code should work on the target machines/servers and be easy deployable there
7. Resulting system should be easy to debug, identify and resolve problems (system maintainability), locally and by remote means.

Supporting principles:
1. Dividing the code into smaller manageable chunks (libraries, modules, components) helps #2, #3 and #4
2. Working system should produce sensible consistent logs -  helps #7
3. Using less third-party libraries and tools have some benefits:
3.1. Dedication to the specific task - 3rd party ones designed for other reasons, might be generic and/or incomplete (hurts #1)
3.2. Third party tools might produce incomplete or inconsistent logging (hurts #7)
3.3. Third party tools might be buggy (including hidden bugs, discoverable only in production (hurts #1, #2)
3.4. Third party tools might require specific setup, tooling or environment (hurts #5, #6)
4. Final result is vaguely outlined; development process can refine and modify the final result expectations based on a few things
4.1. Tooling limitations (db, network bandwidth, storage)
4.2. External documentation limitations (consumable APIs are inconsistent and may cause unexpected/undocumented problems)
4.3. Framework factors (certain logical assumptions while initially seemed reasonable, has to be reworked to streamline the process and to work around discovered limitations) - that's a range of things like OOP vs. functional vs. procedural approach and their combinations
5. There are lots of unknowns, "ifs" and struggles during the development process, and the working code (or prototypes in various stages) should be redesigned and redeveloped given those new factors.



