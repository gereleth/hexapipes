<script>
	import { settings } from '$lib/stores';
	import { onMount } from 'svelte';
	import RotationDirection from '$lib/settings/RotationDirection.svelte';
	import { slide } from 'svelte/transition';

	onMount(() => {
		settings.loadFromLocalStorage();
	});
</script>

<div class="container settings" transition:slide>
	<div class="controlMode">
		<h3>Controls mode</h3>
		<label>
			<input
				type="radio"
				bind:group={$settings.controlMode}
				name="controlMode"
				value={'rotate_lock'}
			/>
			<RotationDirection text={false} /> Rotate / Lock
		</label>
		<label>
			<input
				type="radio"
				bind:group={$settings.controlMode}
				name="controlMode"
				value={'rotate_rotate'}
			/>
			<RotationDirection text={false} /> Rotate / Rotate <RotationDirection
				text={false}
				clockwise={false}
			/>
		</label>
		<label>
			<input
				type="radio"
				bind:group={$settings.controlMode}
				name="controlMode"
				value={'orient_lock'}
			/>
			Orient / Lock
		</label>
		<div class="description">
			{#if $settings.controlMode === 'rotate_lock'}
				<ul>
					<li>Click / touch - rotate tile <RotationDirection /></li>
					<li>Right click / long press - lock tile</li>
					<li>Ctrl-click - rotate tile <RotationDirection clockwise={false} /></li>
				</ul>
			{:else if $settings.controlMode === 'rotate_rotate'}
				<ul>
					<li>Click / touch - rotate tile <RotationDirection /></li>
					<li>Right click / long press - rotate tile <RotationDirection clockwise={false} /></li>
					<li>Ctrl-click - lock tile</li>
				</ul>
			{:else if $settings.controlMode === 'orient_lock'}
				<ul>
					<li>Click or touch once to orient the tile in that direction.</li>
					<li>A tile will rotate so that the little orange dot moves to where you clicked.</li>
					<li>Right click / long press - lock tile</li>
				</ul>
			{/if}
		</div>
		<label>
			<input
				type="checkbox"
				bind:checked={$settings.invertRotationDirection}
				name="invertRotationDirection"
			/>
			Invert rotation direction
		</label>
		<br />
		<label>
			<input type="checkbox" bind:checked={$settings.assistant} name="assistant" />
			Use smart assistant. When you lock a tile or create an edgemark surrounding tiles will rotate to
			match.
		</label>
	</div>
	<div class="controlMode">
		<h3>Timer</h3>
		<label>
			<input type="checkbox" bind:checked={$settings.showTimer} name="showTimer" />
			Show timer
		</label>
	</div>
	<div class="controlMode">
		<h3>Zoom and pan</h3>
		<label>
			Sensitivity when panning with a touchpad
			<input type="range" min="1" max="200" bind:value={$settings.touchpadPanSensitivity} name="touchpadPanSensitivity" />
		</label>
		<br />
		<label>
			<input type="checkbox" bind:checked={$settings.allowEmptySpacePan} name="allowEmptySpacePan" />
			Allow panning while mouse is over empty space
		</label>
		<p>
			If you find current zoom and pan functions uncomfortable you can disable them. Puzzles will be
			shown fully zoomed out. You can rely on browser zoom to deal with small tiles.
		</p>
		<label>
			<input type="checkbox" bind:checked={$settings.disableZoomPan} name="disableZoomPan" />
			Disable zooming and panning
		</label>
		<br />
		<label>
			<input type="checkbox" bind:checked={$settings.disableScrollZoomPan} name="disableScrollZoomPan" />
			Disable zooming and panning using the mouse wheel or touchpad
		</label>
		<p>Please <strong>refresh the page</strong> for the changes to take effect.</p>
	</div>
	<div class="animationSpeed">
		<h3>Animation speed</h3>
		<p>How fast should pipe rotations look.</p>
		<label>
			<input
				type="radio"
				bind:group={$settings.animationSpeed}
				name="animationSpeed"
				value={'normal'}
			/>
			Normal (100 ms)
		</label>
		<label>
			<input
				type="radio"
				bind:group={$settings.animationSpeed}
				name="animationSpeed"
				value={'fast'}
			/>
			Fast (30 ms)
		</label>
		<label>
			<input
				type="radio"
				bind:group={$settings.animationSpeed}
				name="animationSpeed"
				value={'instant'}
			/>
			Instant
		</label>
	</div>
</div>

<style>
	.settings {
		color: var(--text-color);
		background: whitesmoke;
		border-radius: 5px;
		padding: 5px;
		margin: 5px auto;
	}
</style>
