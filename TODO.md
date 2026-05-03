## Target Temp Slider Increments
Change Set temp slider so it doesnt have 0.5 degree increments (1 is enough)

## Default Pump Speed
When pump is turned on and it is a 0% speed - set it to 50% (so the user doesnt have to both turn it on and increase the speed)

## Pump Speed Ramp Up
When a pump is turned on / has its speed changed, instead of going straight to that percent speed, ramp up to that speed over x seconds. FX: The user sets pump to 80%. Instead of going from X to 80 immedietly, it goes from X to X+10, to X+20 etc over 2 seconds until it reaches the 80% (slowly ramping up).  This should happen behind the scenes and the user shouldnt see it, nor should it be reflected in the speed slider.

## Temperature Chart Current Temp
Add current temp for all sensors in the temperature graph for a quick overview. Have them colour coded according to the sensor. 

## Brew Timer Input
Allow clicking anywhere on the brew timer to start / stop it. Currently you have to click around the timer numbers themselves (they wont trigger start/stop). 

Divide the timer card into 3 equally sized regions: 

The behaviour of the timer has to be like this:

- Cliking anywhere inside the brew timer card: Start / Stop
- Dragging anywhere withing the first third (1/3) of the card (where the hour number is): Increase hours
- Dragging anywhere withing the middle (2/3) of the card (where the minutes number is): Increase minutes
- Dragging anywhere withing the last third (3/3) of the card (where the seconds number is): Increase seconds
- Holding anywhere inside the brew timer card: Reset

Remove the feature where dragging seconds down under 0 increases minutes (vice versa for minutes into hours)