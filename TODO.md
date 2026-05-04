
## Pump Speed Ramp Up
When a pump is turned on / has its speed changed, instead of going straight to that percent speed, ramp up to that speed over x seconds. FX: The user sets pump to 80%. Instead of going from X to 80 immedietly, it goes from X to X+10, to X+20 etc over 2 seconds until it reaches the 80% (slowly ramping up).  This should happen behind the scenes and the user shouldnt see it, nor should it be reflected in the speed slider.

## Seperate threshold efficiency settings per pot (BK vs HLT) & Check if setting is wired up correctly
Since the BK has a more powerfull heating element (8.5 kW) than the HLT (5.5 kW) it would make sense for them to have seperate REG efficiency settings based on how far the PV is from the SV. 

Also i tried to change the efficiency in the exposed setting for it, but it didnt appear to be actually reflected in how the system behaved. check that the code is in order.

